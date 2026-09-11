// Descobre quais pares de estruturas do caso se sobrepõem, para que o menu de
// "Isolar parte" só ofereça referências que de fato produzem uma parte isolada.
// Roda fora da thread da página: um caso de 60 MB tem ~1M de triângulos e a
// página não pode congelar enquanto o clínico lê a lista.
//
// "Sobrepor" aqui é exatamente o que o backend exige: a interseção sólida das
// duas malhas não é vazia (processor._apply_boolean_ops recusa o par quando
// é). Mesmo motor do backend — Manifold — para que a tela e o servidor
// concordem.
//
// Protocolo:
//   entrada: { files: File[] }
//   saída:   { a, b, overlaps: true | false | null }  um por par, em qualquer ordem
//            { done: true }                          ao final
// `overlaps: null` = não deu para saber (malha aberta, arquivo ilegível,
// Manifold fora do ar). A página trata como "pode ser" e deixa o backend
// decidir, que é o comportamento de antes desta verificação existir.

import { parseStl, boxesTouch } from "./stl.js";

// Mesma versão do importmap de /case/ (world.js usa para o Cortar). Worker não
// enxerga o importmap da página, por isso a URL inteira.
const MANIFOLD_URL = "https://unpkg.com/manifold-3d@3.5.3/manifold.js";

async function loadManifold() {
  const { default: Module } = await import(MANIFOLD_URL);
  const wasm = await Module();
  wasm.setup();
  return wasm;
}

// Mesmo caminho do world.js: tenta a malha como veio; se o Manifold a achar
// aberta, deixa o Mesh.merge() costurar as arestas abertas por posição.
function toManifold(wasm, data) {
  const { Manifold, Mesh } = wasm;
  try {
    return new Manifold(new Mesh(data));
  } catch (err) {
    if (err?.code !== "NotManifold") throw err;
  }
  const mesh = new Mesh(data);
  mesh.merge();
  return new Manifold(mesh); // ainda aberta: lança NotManifold
}

self.onmessage = async ({ data: { files } }) => {
  const post = (a, b, overlaps) => self.postMessage({ a: a.name, b: b.name, overlaps });

  const meshes = [];
  for (const file of files) {
    try {
      meshes.push({ name: file.name, ...parseStl(await file.arrayBuffer()) });
    } catch {
      meshes.push({ name: file.name, failed: true });
    }
  }

  // Primeiro o que sai de graça: caixas separadas. Só o resto precisa do WASM.
  const pending = [];
  for (let i = 0; i < meshes.length; i++) {
    for (let j = i + 1; j < meshes.length; j++) {
      const a = meshes[i], b = meshes[j];
      if (a.failed || b.failed) post(a, b, null);
      else if (!boxesTouch(a, b)) post(a, b, false);
      else pending.push([a, b]);
    }
  }

  if (pending.length) {
    let wasm = null;
    try {
      wasm = await loadManifold();
    } catch {
      /* sem Manifold: os pares restantes ficam em aberto */
    }

    const solids = new Map(); // nome → Manifold | null (malha recusada)
    const solidOf = (m) => {
      if (!solids.has(m.name)) {
        try {
          solids.set(m.name, toManifold(wasm, m));
        } catch {
          solids.set(m.name, null);
        }
      }
      return solids.get(m.name);
    };

    for (const [a, b] of pending) {
      let overlaps = null;
      const sa = wasm && solidOf(a);
      const sb = wasm && solidOf(b);
      if (sa && sb) {
        let inter = null;
        try {
          inter = sa.intersect(sb);
          overlaps = !inter.isEmpty() && inter.volume() > 0;
        } catch {
          overlaps = null;
        } finally {
          inter?.delete();
        }
      }
      post(a, b, overlaps);
    }
    for (const s of solids.values()) s?.delete();
  }

  self.postMessage({ done: true });
};
