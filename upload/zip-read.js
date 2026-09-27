// upload/zip-read.js
// Lê um .zip no navegador sem descompactar o arquivo inteiro: a lista de
// arquivos (o diretório central, no fim do .zip) e, sob pedido, os primeiros
// bytes de uma entrada. Serve para duas coisas: saber se o .zip é de
// estruturas ou de exame (pelos nomes) e ler o cabeçalho DICOM das imagens de
// dentro dele, para agrupar as séries antes de enviar.
//
// Fora do alcance (vira ZipUnreadable e o .zip segue inteiro para o servidor
// decidir): ZIP64, entrada criptografada, compressão que não seja 0 (stored)
// ou 8 (deflate).

export class ZipUnreadable extends Error {}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const COMMENT_MAX = 65535;

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// [{ name, flags, method, crc, compSize, size, localOffset }], sem pastas.
export async function readZipIndex(file) {
  const tailLen = Math.min(file.size, EOCD_MIN + COMMENT_MAX);
  const tail = await bytesOf(file.slice(file.size - tailLen));
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipUnreadable("sem diretório central");
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipUnreadable("ZIP64");
  }
  const cd = await bytesOf(file.slice(cdOffset, cdOffset + cdSize));
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  // UTF-8 (bit 11) ou CP437. Para o que se faz aqui — extensão e nome de
  // exibição — decodificar CP437 como UTF-8 só estraga acentos.
  const decoder = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== CENTRAL_SIG) {
      throw new ZipUnreadable("diretório central inválido");
    }
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const compSize = cv.getUint32(p + 20, true);
    const size = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const localOffset = cv.getUint32(p + 42, true);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipUnreadable("ZIP64");
    }
    if (name.endsWith("/")) continue; // pasta
    entries.push({ name, flags, method, crc, compSize, size, localOffset });
  }
  return entries;
}

// Dá para ler (e copiar) a entrada no navegador?
export const readable = (entry) => !(entry.flags & 1) && (entry.method === 0 || entry.method === 8);

// Onde começam os dados: o cabeçalho local tem o próprio campo extra, que pode
// ter outro tamanho que o do diretório central.
async function dataStart(file, entry) {
  const h = await bytesOf(file.slice(entry.localOffset, entry.localOffset + 30));
  const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || v.getUint32(0, true) !== LOCAL_SIG) {
    throw new ZipUnreadable("cabeçalho local inválido");
  }
  return entry.localOffset + 30 + v.getUint16(26, true) + v.getUint16(28, true);
}

// Os bytes da entrada como estão no .zip (comprimidos ou não): para copiar
// para outro .zip sem recomprimir. Com o bit 3 (data descriptor, comum em
// .zip do Finder) os tamanhos certos são os do diretório central — os que
// `entry` já carrega.
export async function entryRaw(file, entry) {
  const start = await dataStart(file, entry);
  return file.slice(start, start + entry.compSize);
}

// Primeiros `n` bytes descomprimidos da entrada (menos, se ela for menor).
export async function entryHead(file, entry, n) {
  if (!readable(entry)) throw new ZipUnreadable("compressão não suportada");
  const raw = await entryRaw(file, entry);
  if (entry.method === 0) return bytesOf(raw.slice(0, n));
  if (typeof DecompressionStream === "undefined") throw new ZipUnreadable("navegador sem DecompressionStream");
  const want = Math.min(n, entry.size);
  const out = new Uint8Array(want);
  const reader = raw.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  let got = 0;
  try {
    while (got < want) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, want - got);
      out.set(value.subarray(0, take), got);
      got += take;
    }
  } catch (_) {
    throw new ZipUnreadable("dados comprimidos inválidos");
  } finally {
    // Parar cedo é o ponto: não descomprimir a imagem inteira.
    reader.cancel().catch(() => {});
  }
  return out.subarray(0, got);
}
