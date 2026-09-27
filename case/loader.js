// case/loader.js
// Rede: baixa GLB do R2 e parseia para árvore Three.js. Também expõe um probe
// barato pra Sketchfab, usado quando o R2 retorna 404 e queremos decidir se
// caímos pro viewer legado (/case/legacy/).

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { NRRDLoader } from "three/addons/loaders/NRRDLoader.js";

const loader = new GLTFLoader();

const R2_PUBLIC_BASE = "https://pub-050dac4cd7f7403782e209433488636d.r2.dev";
const SKETCHFAB_API_BASE = "https://api.sketchfab.com/v3/models";

export function buildGlbUrl(uid) {
  return `${R2_PUBLIC_BASE}/cases/${uid}.glb`;
}

// Dev local: um backend em DRY_RUN não sobe nada para o R2, então o link que ele
// devolve nunca abriria o caso recém-processado. Com DRY_RUN_GLB_DIR apontando
// para a raiz servida, o GLB fica em /cases/{uid}.glb aqui mesmo; tentamos esse
// caminho primeiro e caímos no R2 se não existir (permite abrir casos reais
// localmente). Restrito a localhost: em produção resolve direto no R2, sem
// requisição extra.
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export async function resolveGlbUrl(uid) {
  if (!IS_LOCALHOST) return buildGlbUrl(uid);
  const local = `/cases/${uid}.glb`;
  try {
    const r = await fetch(local, { method: "HEAD", cache: "no-cache" });
    if (r.ok) {
      console.info(`[dev] carregando GLB local ${local}`);
      return local;
    }
  } catch (_) {
    // Servidor estático sem o arquivo (ou sem suporte a HEAD): usa o R2.
  }
  return buildGlbUrl(uid);
}

export async function loadGlb(url) {
  // `cache: "no-cache"` forces a conditional revalidation on every load.
  // The browser still serves the cached GLB body via 304 Not Modified for
  // hits, but a previously-cached 404 cannot get pinned — a case uploaded
  // seconds ago will be visible on the next reload.
  const response = await fetch(url, { cache: "no-cache" });

  if (response.status === 404) {
    const err = new Error("GLB_NOT_FOUND");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Falha ao baixar GLB: HTTP ${response.status}`);
    err.code = "NETWORK";
    throw err;
  }

  const buffer = await response.arrayBuffer();

  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, "");
  } catch (e) {
    const err = new Error("Falha ao parsear GLB");
    err.code = "PARSE";
    err.cause = e;
    throw err;
  }

  return { root: gltf.scene, byteLength: buffer.byteLength };
}

// Returns true if Sketchfab knows about this uid, false on 404 or any network
// failure. `cache: "no-cache"` for the same reason as loadGlb. Errors are
// swallowed so a flaky Sketchfab check doesn't prevent the "ask the
// radiologist" message from rendering — false is the safer default.
export async function probeSketchfab(uid) {
  try {
    const r = await fetch(`${SKETCHFAB_API_BASE}/${uid}`, { cache: "no-cache" });
    return r.ok;
  } catch (_) {
    return false;
  }
}

// ============================================================
// Exame de imagem — até 4 séries por caso, ao lado do GLB, mesmo uid.
// Cada série n é um par: cases/{uid}.exam-{n}.nrrd (NRRD canônico do
// mesh-processor: LPS, gzip, só geometria) e cases/{uid}.exam-{n}.json (nome,
// modalidade, nº de imagens, tamanho). O JSON é gravado depois do NRRD: é ele
// que faz a série existir. A série 0 é a usada na segmentação das estruturas.
// Sem manifesto central: exam-0.json 404 = caso sem exame.
// ============================================================

const MAX_EXAM_SERIES = 4;

export function buildExamUrl(uid, n, ext) {
  return `${R2_PUBLIC_BASE}/cases/${uid}.exam-${n}.${ext}`;
}

// JSON de uma série, validado. null = não existe (404), rede fora ou formato
// desconhecido — para o visualizador, "sem essa série".
async function fetchSeriesMeta(base, uid, n) {
  const url = `${base}/cases/${uid}.exam-${n}.json`;
  let meta;
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) return null;
    meta = await r.json();
  } catch (_) {
    return null;
  }
  const ok = meta && meta.version === 1 && typeof meta.label === "string"
    && Array.isArray(meta.shape) && Array.isArray(meta.spacing);
  if (!ok) {
    console.error(`[exam] metadados da série ${n} em formato desconhecido`, meta);
    return null;
  }
  return {
    n,
    url: `${base}/cases/${uid}.exam-${n}.nrrd`,
    label: meta.label,
    images: Number(meta.images) || meta.shape[2],
    spacing: meta.spacing,
    bytes: Number(meta.bytes) || null,
    primary: n === 0,
  };
}

// { exists, series: [{ n, url, label, images, spacing, bytes, primary }] }.
// Um GET barato do exam-0.json; só se ele existir, os outros em paralelo.
// Em localhost tenta os arquivos locais primeiro, como o GLB.
export async function fetchExamSeries(uid) {
  let base = R2_PUBLIC_BASE;
  let first = null;
  if (IS_LOCALHOST) {
    first = await fetchSeriesMeta("", uid, 0);
    if (first) {
      base = "";
      console.info(`[dev] exame local /cases/${uid}.exam-*`);
    }
  }
  if (!first) first = await fetchSeriesMeta(base, uid, 0);
  if (!first) return { exists: false, series: [] };
  const rest = await Promise.all(
    Array.from({ length: MAX_EXAM_SERIES - 1 }, (_, i) => fetchSeriesMeta(base, uid, i + 1)),
  );
  return { exists: true, series: [first, ...rest.filter(Boolean)] };
}

// Baixa e decodifica. Devolve { data, header }: o typed array dos voxels e o
// cabeçalho cru do NRRD (sizes, vectors, space_origin, space). A geometria é
// montada por exam-geom.js — a `volume.matrix` do loader do three não serve
// (ignora a origem).
export async function loadExam(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    const err = new Error(`Falha ao baixar o exame: HTTP ${response.status}`);
    err.code = response.status === 404 ? "NOT_FOUND" : "NETWORK";
    throw err;
  }
  let buffer = await response.arrayBuffer();
  try {
    const volume = new NRRDLoader().parse(buffer);
    buffer = null;
    return { data: volume.data, header: volume.header };
  } catch (e) {
    const err = new Error("Falha ao ler o exame");
    err.code = "PARSE";
    err.cause = e;
    throw err;
  }
}
