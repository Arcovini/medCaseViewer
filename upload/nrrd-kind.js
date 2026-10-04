// upload/nrrd-kind.js
// Um .nrrd pode ser o exame (o volume de imagem) ou a segmentação (labelmap:
// 0 = fundo, cada outro valor = uma estrutura). A segmentação vai no campo
// `files` e o mesh-processor a transforma no 3D (segmentation.py); o volume vai
// no campo `exam`. É assim que um caso sai só de NRRDs: a segmentação e o
// volume do 3D Slicer, ou só a segmentação.
//
// Quem decide é esta leitura, na ordem:
//   1. campos SegmentN_* no cabeçalho (o .seg.nrrd do 3D Slicer) → segmentação,
//      com os nomes dos segmentos;
//   2. volume 4D com o primeiro eixo "list" (camadas do Slicer) ou nome
//      terminando em .seg.nrrd → segmentação;
//   3. senão, pelos valores: inteiros ≥ 0 com poucos valores diferentes é
//      segmentação (ITK-SNAP, nnU-Net, uma máscara binária). Um exame tem
//      centenas de tons (o ultrassom de 8 bits, 256) ou valores negativos (a
//      TC). A leitura para no primeiro valor que decide "imagem", então um
//      exame de 200 MB não é descomprimido inteiro.
// Os nomes saem como o backend vai gravá-los (segmentation.py): sem acento, e
// "Segmento <n>" quando o arquivo não traz nome.
//
// De uma segmentação sai também onde ela fica no paciente (geometry.js): a
// grade do arquivo, a do volume em que foi desenhada (o Slicer grava) e a caixa
// dos voxels marcados. A página usa isso para avisar quando o exame enviado
// não é a série em que a segmentação foi feita.

import { nrrdGeometry, slicerReferenceGeometry } from "./geometry.js";

// Mais valores que isto não é segmentação. Com o nome do arquivo dizendo que é
// (label, mask, seg), vale o limite do backend (TotalSegmentator: 117).
const MAX_LABELS_GUESS = 64;
const MAX_LABELS_NAMED = 128;
const HINT = /(^|[^a-z])(seg|segmentation|segmentacao|segmentação|label|labels|labelmap|mask)([^a-z]|$)/i;
const SEG_WORD_TAIL = /[\s._-]*(seg|segmentation|segmentacao|label|labels|labelmap|mask)$/i;
const HEADER_MAX = 1024 * 1024;

const TYPES = {
  "signed char": "i8", int8: "i8", int8_t: "i8",
  uchar: "u8", "unsigned char": "u8", uint8: "u8", uint8_t: "u8",
  short: "i16", "short int": "i16", "signed short": "i16", "signed short int": "i16", int16: "i16", int16_t: "i16",
  ushort: "u16", "unsigned short": "u16", "unsigned short int": "u16", uint16: "u16", uint16_t: "u16",
  int: "i32", "signed int": "i32", int32: "i32", int32_t: "i32",
  uint: "u32", "unsigned int": "u32", uint32: "u32", uint32_t: "u32",
  float: "f32", double: "f64",
};
const BYTES = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8 };

// Como segmentation._clean_name: sem acento, sem caractere de controle.
export function cleanName(text) {
  return String(text || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ").replace(/^[ _]+|[ _]+$/g, "")
    .slice(0, 64);
}

export function fileStem(name) {
  const base = String(name).split("/").pop().replace(/(\.seg)?\.nrrd$/i, "").replace(SEG_WORD_TAIL, "");
  return cleanName(base);
}

// Cabeçalho até a linha em branco. → { fields, segments: Map<n, {...}>, extras,
// dataStart } | null. extras: os outros campos "chave:=valor" (os Segmentation_*
// do Slicer).
async function readHeader(file) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, HEADER_MAX)).arrayBuffer());
  if (String.fromCharCode(...head.slice(0, 4)) !== "NRRD") return null;
  let end = -1;
  for (let i = 0; i < head.length - 1; i++) {
    if (head[i] === 10 && head[i + 1] === 10) { end = i; break; }
    if (head[i] === 13 && head[i + 1] === 10 && head[i + 2] === 13 && head[i + 3] === 10) { end = i + 2; break; }
  }
  if (end < 0) return null;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head.slice(0, end));
  } catch {
    text = new TextDecoder("latin1").decode(head.slice(0, end));
  }
  const fields = {};
  const segments = new Map();
  const extras = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    const kv = line.indexOf(":=");
    if (kv > 0) {
      const m = line.slice(0, kv).trim().match(/^Segment(\d+)_(\w+)$/);
      if (m) {
        const n = Number(m[1]);
        if (!segments.has(n)) segments.set(n, {});
        segments.get(n)[m[2]] = line.slice(kv + 2).trim();
      } else {
        extras[line.slice(0, kv).trim()] = line.slice(kv + 2);
      }
      continue;
    }
    const c = line.indexOf(":");
    if (c > 0) fields[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return { fields, segments, extras, dataStart: end + (head[end] === 13 ? 2 : 2) };
}

// Passa pelos valores do volume e devolve { labels, box }: os valores diferentes
// de zero, em ordem, e a caixa (índices i, j, k) dos voxels marcados; ou null
// assim que um valor disser "isto é imagem" (negativo, não inteiro, ou valores
// demais). Numa segmentação em camadas o primeiro eixo é a camada.
async function scanLabels(file, header, maxLabels) {
  const { fields, dataStart } = header;
  const type = TYPES[(fields.type || "").toLowerCase()];
  const encoding = (fields.encoding || "").toLowerCase();
  if (!type || !["raw", "gzip", "gz"].includes(encoding)) return null;
  if (encoding !== "raw" && typeof DecompressionStream === "undefined") return null;
  const size = BYTES[type];
  const little = (fields.endian || "little").toLowerCase() !== "big";
  const dims = (fields.sizes || "").trim().split(/\s+/).map(Number);
  const layers = dims.length === 4 ? dims[0] : 1;
  const [s0, s1] = dims.length === 4 ? dims.slice(1) : dims;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let index = 0; // valores já lidos antes deste pedaço

  let stream = file.slice(dataStart).stream();
  if (encoding !== "raw") stream = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const seen = new Set();
  let carry = new Uint8Array(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let bytes = value;
      if (carry.length) {
        bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
      }
      const n = Math.floor(bytes.length / size);
      carry = bytes.slice(n * size);
      const view = new DataView(bytes.buffer, bytes.byteOffset, n * size);
      for (let i = 0; i < n; i++) {
        const o = i * size;
        let v;
        switch (type) {
          case "u8": v = bytes[o]; break;
          case "i8": v = view.getInt8(o); break;
          case "u16": v = view.getUint16(o, little); break;
          case "i16": v = view.getInt16(o, little); break;
          case "u32": v = view.getUint32(o, little); break;
          case "i32": v = view.getInt32(o, little); break;
          case "f32": v = view.getFloat32(o, little); break;
          default: v = view.getFloat64(o, little);
        }
        if (v === 0) continue;
        if (v < 0 || !Number.isInteger(v)) return null;
        if (dims.length >= 3) {
          const sp = layers > 1 ? Math.floor((index + i) / layers) : index + i;
          const x = sp % s0, t = (sp - x) / s0, y = t % s1, z = (t - y) / s1;
          if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
          if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
          if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
        }
        if (!seen.has(v)) {
          seen.add(v);
          if (seen.size > maxLabels) return null;
        }
      }
      index += n;
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  return {
    labels: [...seen].sort((a, b) => a - b),
    box: Number.isFinite(lo[0]) ? { lo, hi } : null,
  };
}

// → null (não dá para ler: fica como exame, o servidor decide)
//   | { kind: "image" }
//   | { kind: "segmentation", names: string[], geometry, reference, box }
//     geometry: a grade do arquivo; reference: a do volume em que foi desenhada
//     (o Slicer grava; null nos outros); box: caixa dos voxels marcados (null se
//     não deu para ler os valores). Ver geometry.js.
export async function nrrdKind(file) {
  let header;
  try {
    header = await readHeader(file);
  } catch {
    return null;
  }
  if (!header) return null;

  const geometry = nrrdGeometry(header.fields);
  const reference = slicerReferenceGeometry(header.extras.Segmentation_ConversionParameters);
  const seg = (names, scan) => ({ kind: "segmentation", names, geometry, reference, box: scan?.box ?? null });

  if (header.segments.size) {
    const names = [...header.segments.keys()].sort((a, b) => a - b)
      .map((n) => cleanName(header.segments.get(n).Name) || `Segmento ${n + 1}`);
    return seg(dedupe(names), await scanLabels(file, header, Infinity));
  }

  const kinds = (header.fields.kinds || "").toLowerCase().split(/\s+/);
  const layered = header.fields.dimension === "4" && kinds[0] === "list";
  const named = /\.seg\.nrrd$/i.test(file.name);
  const hinted = HINT.test(file.name.replace(/\.nrrd$/i, ""));
  const scan = await scanLabels(file, header, named || layered || hinted ? MAX_LABELS_NAMED : MAX_LABELS_GUESS);
  if (!scan) {
    // O cabeçalho já tinha dito "segmentação": o backend lê e, se não for,
    // explica. Sem os valores, uma linha só com o nome do arquivo.
    return named || layered ? seg([fileStem(file.name) || "Segmento 1"], null) : { kind: "image" };
  }
  const { labels } = scan;
  if (!labels.length) return named || layered ? seg([], scan) : { kind: "image" };
  if (labels.length === 1 && !layered) return seg([fileStem(file.name) || "Segmento 1"], scan);
  // Camadas sem cabeçalho do Slicer: o backend nomeia por camada.valor; aqui
  // não vale a pena separar camadas — conta-se pelo total de valores.
  return seg(labels.map((v) => `Segmento ${v}`), scan);
}

function dedupe(names) {
  const used = new Set();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${name} ${n}`;
    used.add(candidate);
    return candidate;
  });
}
