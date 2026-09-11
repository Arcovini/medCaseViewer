// Leitura de STL (binário ou ASCII) → malha indexada no formato do MeshGL do
// Manifold ({numProp, vertProperties, triVerts}) + caixa envolvente.
// Módulo puro: sem DOM, sem rede — roda igual na página e no worker.
//
// Os vértices são soldados pela posição exata, que é o que o trimesh faz ao
// carregar o STL no mesh-processor: a malha medida aqui é a mesma que o
// backend vai dividir.

export function parseStl(buffer) {
  const soup = isBinary(buffer) ? binarySoup(buffer) : asciiSoup(buffer);
  if (soup.length === 0) throw new Error("STL sem triângulos");
  return weld(soup);
}

// O tamanho bate com a contagem de triângulos do cabeçalho → binário. Senão,
// ASCII só se começar com "solid" E trouxer facetas logo no início: há
// exportadores que escrevem "solid" no cabeçalho de 80 bytes de um binário.
function isBinary(buffer) {
  if (buffer.byteLength >= 84) {
    const n = new DataView(buffer).getUint32(80, true);
    if (84 + 50 * n === buffer.byteLength) return true;
  }
  const head = new TextDecoder().decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)),
  );
  return !(/^\s*solid/.test(head) && /facet|vertex/.test(head));
}

function binarySoup(buffer) {
  const view = new DataView(buffer);
  const n = view.getUint32(80, true);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const base = 84 + t * 50 + 12; // pula a normal
    for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(base + k * 4, true);
  }
  return out;
}

function asciiSoup(buffer) {
  const text = new TextDecoder().decode(buffer);
  const values = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text))) values.push(+m[1], +m[2], +m[3]);
  return Float32Array.from(values.slice(0, values.length - (values.length % 9)));
}

function weld(soup) {
  const ids = new Map();
  const verts = [];
  const tris = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const idOf = (i) => {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    // String(-0) === "0": zero negativo e positivo viram o mesmo vértice.
    const key = `${x},${y},${z}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      ids.set(key, id);
      verts.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    return id;
  };
  for (let t = 0; t < soup.length; t += 9) {
    const a = idOf(t), b = idOf(t + 3), c = idOf(t + 6);
    // Triângulo degenerado (dois cantos no mesmo ponto) não tem área nem
    // orientação; o trimesh também o descarta.
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return {
    numProp: 3,
    vertProperties: Float32Array.from(verts),
    triVerts: Uint32Array.from(tris),
    min,
    max,
  };
}

// Caixas que não se tocam garantem que as malhas não se sobrepõem — e é o
// caso comum entre estruturas distantes, então evita a conta cara.
export function boxesTouch(a, b) {
  for (let k = 0; k < 3; k++) {
    if (a.max[k] < b.min[k] || b.max[k] < a.min[k]) return false;
  }
  return true;
}
