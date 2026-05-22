// case/loader.js
// Rede: baixa GLB do R2 e parseia para árvore Three.js. Também expõe um probe
// barato pra Sketchfab, usado quando o R2 retorna 404 e queremos decidir se
// caímos pro viewer legado (/case/legacy/).

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

const R2_PUBLIC_BASE = "https://pub-050dac4cd7f7403782e209433488636d.r2.dev";
const SKETCHFAB_API_BASE = "https://api.sketchfab.com/v3/models";

export function buildGlbUrl(uid) {
  return `${R2_PUBLIC_BASE}/cases/${uid}.glb`;
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
