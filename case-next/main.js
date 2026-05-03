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

  const structures = world.getMeshNames().map((name) => ({
    name,
    color: world.getMeshColor(name),
  }));

  dom.renderStructures(structures, {
    onToggle: (name, visible) => {
      // setVisibility(true) re-applies the restored opacity to material; must precede getMeshOpacity.
      world.setVisibility(name, visible);
      if (visible) {
        const last = world.getMeshOpacity(name) ?? 1;
        dom.setSliderValue(name, last);
      } else {
        dom.setSliderValue(name, 0);
      }
    },
    onOpacityChange: (name, value) => {
      world.setOpacity(name, value);
      dom.setEyeState(name, value > 0);
    },
  });
  dom.showLoading(false);
  dom.initBottomSheet();
}

bootstrap();

// Test hook: when Playwright sets window.__playwrightTest before page load,
// expose `world` and `dom` modules so tests can inspect/mutate state. No-op in production.
if (window.__playwrightTest) {
  window.__world = world;
  window.__dom = dom;
}
