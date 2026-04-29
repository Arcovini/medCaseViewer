// case-next/main.js
// Composition root: reads UID from URL, fetches GLB from R2, mounts scene, renders panel.

import * as world from "./world.js";
import * as loader from "./loader.js";
import * as dom from "./dom.js";

const R2_PUBLIC_BASE = "https://pub-050dac4cd7f7403782e209433488636d.r2.dev";

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("id");

  const canvas = document.getElementById("canvas");
  world.init(canvas);

  if (!uid) {
    dom.showError("UID do caso não informado na URL.");
    return;
  }

  dom.showLoading(true);
  const url = `${R2_PUBLIC_BASE}/cases/${uid}.glb`;

  let root;
  try {
    ({ root } = await loader.loadGlb(url));
  } catch (e) {
    dom.showLoading(false);
    if (e.code === "NOT_FOUND") {
      dom.showError(`Caso não encontrado: ${uid}.`);
    } else if (e.code === "PARSE") {
      dom.showError("Arquivo do modelo está corrompido. Contate o suporte.");
    } else {
      dom.showError("Erro ao carregar o modelo. Verifique sua conexão e tente novamente.");
    }
    return;
  }

  world.mount(root);
  world.frameToScene();

  dom.renderStructures(world.getMeshNames(), (name, visible) => {
    world.setVisibility(name, visible);
  });
  dom.showLoading(false);
}

bootstrap();

// Test hook: when Playwright sets window.__playwrightTest before page load,
// expose `world` module so tests can inspect scene state. No-op in production.
if (window.__playwrightTest) {
  window.__world = world;
}
