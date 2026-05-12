// case-next/main.js
// Composition root: reads UID from URL, fetches GLB from R2, mounts scene, renders panel.

import * as world from "./world.js";
import * as loader from "./loader.js";
import * as dom from "./dom.js";
import * as measurement from "./measurement.js";
import * as ar from "./ar.js";

let measurementApi = null;

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
  const url = loader.buildGlbUrl(uid);

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

  // Inicializa measurement antes de renderizar o painel pra que o callback onToggle
  // possa avisar sobre malha-âncora ocultada via measurementApi.onMeshVisibilityChange.
  measurementApi = measurement.init({ world, dom });

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
      measurementApi.onMeshVisibilityChange(name, visible);
    },
    onOpacityChange: (name, value) => {
      world.setOpacity(name, value);
      dom.setEyeState(name, value > 0);
    },
  });
  dom.showLoading(false);
  dom.initBottomSheet();

  // Inicializa o módulo AR depois do GLB já estar montado: ar.js precisa
  // da cena do world.js pra geração on-demand do USDZ no iOS, e do uid pra
  // construir a URL do GLB no <model-viewer>. Falhas em ar.init são
  // tratadas internamente — não devem bloquear o resto do viewer.
  ar.init({ world, dom, uid });
}

bootstrap();

// Test hook: when Playwright sets window.__playwrightTest before page load,
// expose `world`, `dom`, and `measurement` modules so tests can inspect/mutate state.
// No-op in production.
if (window.__playwrightTest) {
  window.__world = world;
  window.__dom = dom;
  window.__ar = ar;
  // measurementApi vira disponível apenas após bootstrap() resolver.
  // Tests que dependem dele já esperam pelo painel renderizar (sinal que main.js terminou).
  Object.defineProperty(window, "__measurement", {
    get: () => measurementApi,
  });
}
