// upload/zip-write.js
// Monta um .zip no navegador sem juntar tudo num buffer só: o Blob final é
// feito de pedaços (cabeçalhos + File/Blob), e o navegador lê os arquivos na
// hora de enviar. Uso: um .zip por série do exame, só com as imagens que o
// clínico escolheu — o servidor já sabe ler .zip, e assim nem o limite de
// arquivos soltos por request nem as séries não escolhidas entram no envio.

const UTF8_FLAG = 0x0800;
const DOS_DATE_1980 = 0x21; // 1980-01-01: a data não importa aqui

let crcTable = null;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Response(stream).blob();
}

// items: { name, file }  — arquivo solto: comprimido quando ajuda;
//        { name, raw, crc, size, method } — copiado de outro .zip como está.
// onItem(i): progresso (arquivos prontos).
export async function buildZip(items, { onItem } = {}) {
  if (items.length > 0xffff) throw new Error("Arquivos demais para um .zip simples.");
  const encoder = new TextEncoder();
  const canDeflate = typeof CompressionStream !== "undefined";
  const parts = [];
  const central = [];
  let offset = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let data, crc, size, method;
    if (it.raw) {
      ({ raw: data, crc, size, method } = it);
    } else {
      const bytes = new Uint8Array(await it.file.arrayBuffer());
      crc = crc32(bytes);
      size = bytes.length;
      data = it.file;
      method = 0;
      if (canDeflate && size > 0) {
        const z = await deflate(bytes);
        if (z.size < size) { data = z; method = 8; }
      }
    }
    const name = encoder.encode(it.name);
    const compSize = data.size;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, method, true);
    local.setUint16(12, DOS_DATE_1980, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compSize, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8_FLAG, true);
    c.setUint16(10, method, true);
    c.setUint16(14, DOS_DATE_1980, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, compSize, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, name);

    offset += 30 + name.length + compSize;
    if (offset > 0xffffffff) throw new Error("Série grande demais para um .zip simples.");
    onItem?.(i + 1);
  }

  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
