// case-next/loader.js
// Rede: baixa GLB e parseia para árvore Three.js.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

const R2_PUBLIC_BASE = "https://pub-050dac4cd7f7403782e209433488636d.r2.dev";

export function buildGlbUrl(uid) {
  return `${R2_PUBLIC_BASE}/cases/${uid}.glb`;
}

export async function loadGlb(url) {
  const response = await fetch(url);

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
