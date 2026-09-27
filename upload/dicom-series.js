// upload/dicom-series.js
// Lê o cabeçalho de cada imagem do exame (sem os pixels) e agrupa por série,
// para o clínico escolher quais séries entram no caso antes de enviar.
//
// Repete no navegador as recusas que o mesh-processor faz pelo cabeçalho
// (exam.py): série com menos de 8 imagens (localizador, scout) fica de fora;
// tamanhos misturados, orientações misturadas, imagens repetidas ou faltando
// deixam a série desativada com o mesmo motivo que o servidor daria. Assim
// ninguém espera minutos de envio para receber um 400.
//
// O leitor é o dicom-parser (script global `dicomParser`, carregado no
// index.html). Nada do que é lido aqui sai do computador, exceto o próprio
// arquivo DICOM no envio — e lá o servidor fica só com imagem e geometria.

import { entryHead, entryRaw, readable } from "./zip-read.js";
import { buildZip } from "./zip-write.js";

// Espelha exam.py (MIN_SLICES_PER_SERIES, IOP_TOL, SPACING_TOL_MM/REL).
export const MIN_SLICES_PER_SERIES = 8;
const IOP_TOL = 1e-4;
const SPACING_TOL_MM = 0.01;
const SPACING_TOL_REL = 0.01;

const HEAD_STEPS = [64 * 1024, 512 * 1024];
const IMPLICIT_LE = "1.2.840.10008.1.2";
const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const PIXEL_DATA = "x7fe00010";
const POOL = 8;

// ---- Cabeçalho -----------------------------------------------------------------

function parseAs(bytes, transferSyntax) {
  const opts = { untilTag: PIXEL_DATA, TransferSyntaxUID: transferSyntax };
  try {
    return window.dicomParser.parseDicom(bytes, opts);
  } catch (e) {
    // Buffer cortado no meio: o dicom-parser devolve o que conseguiu ler.
    return e && e.dataSet ? e.dataSet : null;
  }
}

// Com o preâmbulo "DICM", a Transfer Syntax vem do próprio arquivo. Sem ele
// (saída crua de alguns PACS), tenta VR implícito e depois explícito — o
// pydicom com force=True também descobre sozinho.
function parse(bytes, dicm) {
  const first = headerOf(parseAs(bytes, IMPLICIT_LE));
  if (dicm || first?.geometry) return first;
  const second = headerOf(parseAs(bytes, EXPLICIT_LE));
  return second?.geometry ? second : first;
}

const clean = (s) => (s || "").replace(/[\0\s]+$/, "").replace(/^\s+/, "");

function read(fn) {
  try { return fn(); } catch (_) { return undefined; } // elemento cortado
}

function numbers(ds, tag) {
  const s = read(() => ds.string(tag));
  if (!s) return null;
  const v = s.split("\\").map(Number);
  return v.every(Number.isFinite) ? v : null;
}

function headerOf(ds) {
  if (!ds) return null;
  const str = (tag) => clean(read(() => ds.string(tag)));
  const rows = read(() => ds.uint16("x00280010"));
  const cols = read(() => ds.uint16("x00280011"));
  const ipp = numbers(ds, "x00200032");
  const iop = numbers(ds, "x00200037");
  const ps = numbers(ds, "x00280030");
  return {
    series: str("x0020000e") || "sem-uid",
    description: str("x0008103e"),
    modality: str("x00080060") || null,
    frameOfRef: str("x00200052") || null,
    photometric: str("x00280004") || "MONOCHROME2",
    localizer: /(^|\\)LOCALIZER(\\|$)/i.test(str("x00080008")),
    frames: parseInt(str("x00280008") || "1", 10) || 1,
    rows, cols, ipp, iop, ps,
    geometry: !!(rows && cols && ipp?.length === 3 && iop?.length === 6 && ps?.length === 2),
  };
}

const hasPreamble = (b) => b.length > 132 && b[128] === 0x44 && b[129] === 0x49 && b[130] === 0x43 && b[131] === 0x4d;

// O parse achou alguma coisa de DICOM (e não só lixo lido como VR implícito)?
const looksDicom = (h) => !!h && (h.series !== "sem-uid" || !!h.rows || !!h.modality);

// Lê o cabeçalho com o menor pedaço que bastar: 64 KB, 512 KB, o arquivo todo.
// Só pede mais quando o primeiro pedaço tem cara de DICOM: um binário qualquer
// sem extensão não é lido inteiro (nem descompactado inteiro, dentro de .zip).
async function readHeader(getBytes, size) {
  let last = null;
  for (const step of [...HEAD_STEPS, Infinity]) {
    const want = Math.min(step, size);
    const bytes = await getBytes(want);
    const dicm = hasPreamble(bytes);
    last = { header: parse(bytes, dicm), dicm };
    if (last.header?.geometry || want >= size) return last;
    if (!dicm && !looksDicom(last.header)) return last;
  }
  return last;
}

// ---- Leitura de tudo --------------------------------------------------------------

// sources: [{ file }] (arquivo solto) ou [{ zip: File, entry }] (dentro de .zip).
// onProgress(feitos, total).
async function readAll(sources, onProgress) {
  const out = new Array(sources.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < sources.length) {
      const i = next++;
      const s = sources[i];
      let r = null;
      try {
        if (s.file) {
          r = await readHeader((n) => s.file.slice(0, n).arrayBuffer().then((b) => new Uint8Array(b)), s.file.size);
        } else if (readable(s.entry)) {
          r = await readHeader((n) => entryHead(s.zip, s.entry, n), s.entry.size);
        }
      } catch (_) {
        r = null;
      }
      out[i] = { source: s, header: r?.header ?? null, dicm: !!r?.dicm };
      onProgress?.(++done, sources.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, sources.length) }, worker));
  return out;
}

// O que a imagem ocupa no envio (comprimida, se veio num .zip) e descompactada
// (o que o servidor soma contra MAX_UNZIPPED_BYTES).
const sizeOf = (s) => (s.file ? s.file.size : s.entry.compSize);
const rawSizeOf = (s) => (s.file ? s.file.size : s.entry.size);

// ---- Agrupar e validar como o servidor ----------------------------------------------

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Ordem pela posição ao longo da normal (nunca InstanceNumber) e o mesmo teste
// de espaçamento de exam._stack_series. Devolve { spacing, problem }.
function checkSpacing(s) {
  const normal = cross(s.iop.slice(0, 3), s.iop.slice(3, 6));
  const pos = s.slices.map((sl) => sl.ipp[0] * normal[0] + sl.ipp[1] * normal[1] + sl.ipp[2] * normal[2]);
  const order = pos.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  s.slices = order.map(([, i]) => s.slices[i]);
  const sorted = order.map(([p]) => p);
  const gaps = sorted.slice(1).map((p, i) => p - sorted[i]);
  const m = median(gaps);
  if (m <= SPACING_TOL_MM || gaps.some((g) => Math.abs(g) <= SPACING_TOL_MM)) {
    return { spacing: m, problem: "Tem imagens repetidas na mesma posição (duas séries misturadas ou arquivos duplicados)." };
  }
  const tol = Math.max(SPACING_TOL_MM, SPACING_TOL_REL * m);
  if (gaps.some((g) => Math.abs(g - m) > tol)) {
    return { spacing: m, problem: "Tem espaçamento irregular entre as imagens: provavelmente faltam imagens." };
  }
  return { spacing: m, problem: null };
}

// → { series: [série DICOM], ignored, multiframe, shortest }
//   série: { key, kind: "dicom", description, modality, frameOfRef, images,
//            spacing, bytes, slices: [{ ipp, source }], problem }
export async function readDicomSeries(sources, onProgress) {
  const results = await readAll(sources, onProgress);
  const groups = new Map();
  let ignored = 0, multiframe = 0;
  const unreadable = [];

  for (const { source, header: h, dicm } of results) {
    if (!h || !h.geometry) {
      // Tem cara de DICOM mas o navegador não leu (compressão do conjunto de
      // dados, cabeçalho estranho): guardado para o caso de não sobrar série.
      if (dicm) unreadable.push(source);
      else ignored++;
      continue;
    }
    if (h.frames > 1) { multiframe++; continue; }
    // Imagem de referência dos planos dentro de uma reconstrução (MPR/MIP),
    // em outra orientação: não é fatia (espelha exam.py).
    if (h.localizer) { ignored++; continue; }
    if (h.photometric !== "MONOCHROME1" && h.photometric !== "MONOCHROME2") { ignored++; continue; }
    let s = groups.get(h.series);
    if (!s) {
      s = {
        key: h.series, kind: "dicom", description: h.description, modality: h.modality,
        frameOfRef: h.frameOfRef, rows: h.rows, cols: h.cols, iop: h.iop,
        slices: [], bytes: 0, rawBytes: 0, problem: null,
      };
      groups.set(h.series, s);
    } else if (!s.problem) {
      if (h.rows !== s.rows || h.cols !== s.cols) {
        s.problem = "Mistura imagens de tamanhos diferentes.";
      } else if (h.iop.some((v, i) => Math.abs(v - s.iop[i]) > IOP_TOL)) {
        s.problem = "Mistura orientações diferentes (por exemplo axial e coronal).";
      }
    }
    s.slices.push({ ipp: h.ipp, source });
    s.bytes += sizeOf(source);
    s.rawBytes += rawSizeOf(source);
  }

  const series = [];
  let shortest = null;
  for (const s of groups.values()) {
    if (s.slices.length < MIN_SLICES_PER_SERIES) {
      ignored += s.slices.length;
      shortest = Math.max(shortest ?? 0, s.slices.length);
      continue;
    }
    const { spacing, problem } = checkSpacing(s);
    s.spacing = spacing;
    s.images = s.slices.length;
    if (!s.problem) s.problem = problem;
    series.push(s);
  }

  // Nada legível, mas há arquivos DICOM: vão juntos como uma série só e o
  // servidor decide (é o que acontecia antes da escolha no navegador).
  if (!series.length && unreadable.length >= MIN_SLICES_PER_SERIES) {
    series.push({
      key: "dicom:nao-lido", kind: "dicom", description: "", modality: null, frameOfRef: null,
      images: unreadable.length, spacing: null, problem: null, unread: true,
      slices: unreadable.map((source) => ({ ipp: null, source })),
      bytes: unreadable.reduce((a, s) => a + sizeOf(s), 0),
      rawBytes: unreadable.reduce((a, s) => a + rawSizeOf(s), 0),
    });
  } else {
    ignored += unreadable.length;
  }
  return { series, ignored, multiframe, shortest };
}

// O .zip de uma série: as imagens escolhidas, na ordem da posição. Arquivos
// soltos são comprimidos aqui; os que já vieram num .zip são copiados como
// estão.
export async function seriesZip(s, onItem) {
  const items = [];
  for (let i = 0; i < s.slices.length; i++) {
    const src = s.slices[i].source;
    const name = `IM${String(i + 1).padStart(5, "0")}`;
    if (src.file) {
      items.push({ name, file: src.file });
    } else {
      items.push({
        name, raw: await entryRaw(src.zip, src.entry),
        crc: src.entry.crc, size: src.entry.size, method: src.entry.method,
      });
    }
  }
  return buildZip(items, { onItem });
}

// ---- NRRD: o cabeçalho é texto -----------------------------------------------------

// { images, spacing } lidos do cabeçalho do .nrrd (4 KB bastam); null se não der.
export async function nrrdInfo(file) {
  try {
    const text = new TextDecoder("latin1").decode(await file.slice(0, 4096).arrayBuffer());
    if (!text.startsWith("NRRD")) return null;
    const sizes = text.match(/^sizes:\s*(\d+)\s+(\d+)\s+(\d+)\s*$/m);
    const dirs = text.match(/^space directions:\s*(.+)$/m);
    let spacing = null;
    if (dirs) {
      const vecs = [...dirs[1].matchAll(/\(([^)]+)\)/g)].map((m) => m[1].split(",").map(Number));
      if (vecs.length === 3) spacing = Math.hypot(...vecs[2]);
    }
    return sizes ? { images: Number(sizes[3]), spacing } : null;
  } catch (_) {
    return null;
  }
}
