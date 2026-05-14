// case-next/main.js
// Composition root: reads UID from URL, fetches GLB from R2, mounts scene, renders panel.

import * as world from "./world.js";
import * as loader from "./loader.js";
import * as dom from "./dom.js";
import * as measurement from "./measurement.js";
import * as volume from "./volume.js";
import * as ar from "./ar.js";

let measurementApi = null;
let volumeApi = null;
let fab = null;

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

  let root, byteLength;
  try {
    ({ root, byteLength } = await loader.loadGlb(url));
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

  // FAB único compartilhado entre Linear e Volume. main.js controla.
  fab = dom.mountMeasurementFAB({
    onClick: () => menu.toggle(),
  });

  // Hint banner compartilhado entre Linear e Volume — uma única instância DOM.
  const hint = dom.mountHintBanner();

  // Inicializa measurement antes de renderizar o painel pra que o callback onToggle
  // possa avisar sobre malha-âncora ocultada via measurementApi.onMeshVisibilityChange.
  measurementApi = measurement.init({
    world,
    dom,
    hint,
    onExit: () => fab.setVisible(true),
  });

  volumeApi = volume.init({
    world,
    dom,
    hint,
    onExit: () => fab.setVisible(true),
  });

  const menu = dom.mountMeasurementMenu({
    anchorEl: fab.getElement(),
    onPickLinear: () => {
      fab.setVisible(false);
      measurementApi.startLinear();
    },
    onPickVolume: () => {
      fab.setVisible(false);
      volumeApi.startVolume();
    },
  });

  fab.setVisible(true);

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

  bindRedesignChrome(structures, uid, byteLength);

  // Inicializa o módulo AR depois do GLB já estar montado: ar.js precisa
  // da cena do world.js pra geração on-demand do USDZ no iOS, e do uid pra
  // construir a URL do GLB no <model-viewer>. Falhas em ar.init são
  // tratadas internamente — não devem bloquear o resto do viewer.
  ar.init({ world, dom, uid });
}

bootstrap();

// ============================================================
// REDESIGN CHROME — populates the new viewer chrome (top bar / zoom /
// legend / case-head / foot strip) and wires the handlers. Pure DOM,
// reads from world/dom/loader results.
// ============================================================

function bindRedesignChrome(structures, uid, byteLength) {
  const uidShort = uid.slice(0, 8);
  setBind("uid-short", uidShort);
  setBind("case-title", `Caso ${uidShort}`);
  setBind("case-pid", `ID ${uid}`);
  setBind("kv-count", `${structures.length} camadas`);
  setBind("structure-count", `${structures.length} ${structures.length === 1 ? "camada" : "camadas"}`);
  setBind("foot-count", String(structures.length));
  setBind("foot-size", byteLength ? `${(byteLength / (1024 * 1024)).toFixed(1)} MB` : "—");

  const crumbEl = document.querySelector('[data-bind="crumb"]');
  if (crumbEl && structures.length >= 2) {
    const a = humanizeName(structures[0].name);
    const b = humanizeName(structures[1].name);
    crumbEl.innerHTML = `Reconstrução · <b>${escapeHtml(a)} + ${escapeHtml(b)}</b>`;
  }

  const legendRows = document.querySelector('[data-bind="legend-rows"]');
  if (legendRows) {
    legendRows.innerHTML = "";
    for (const { name, color } of structures) {
      const row = document.createElement("div");
      row.className = "vw-legend-row";
      const dot = document.createElement("span");
      dot.className = "vw-legend-dot";
      if (color) dot.style.background = color;
      const label = document.createElement("span");
      label.textContent = humanizeName(name);
      row.appendChild(dot);
      row.appendChild(label);
      legendRows.appendChild(row);
    }
  }

  wireAction("reset-camera", () => world.frameToScene());
  wireAction("fullscreen", toggleFullscreen);
  wireAction("share", shareCurrentUrl);

  wireAction("zoom-in", () => { world.zoomBy(1.2); updateZoomPct(); });
  wireAction("zoom-out", () => { world.zoomBy(1 / 1.2); updateZoomPct(); });
  world.onCameraChange(updateZoomPct);
  updateZoomPct();
}

function setBind(name, text) {
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => {
    el.textContent = text;
  });
}

function wireAction(name, handler) {
  document.querySelectorAll(`[data-action="${name}"]`).forEach((el) => {
    el.addEventListener("click", handler);
  });
}

function updateZoomPct() {
  const pct = world.getZoomPercentage();
  setBind("zoom-pct", `${pct}%`);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.body.requestFullscreen?.();
  }
}

async function shareCurrentUrl() {
  const url = window.location.href;
  try {
    await navigator.clipboard?.writeText(url);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
}

function humanizeName(name) {
  return String(name).replace(/_/g, " ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Test hook: when Playwright sets window.__playwrightTest before page load,
// expose `world`, `dom`, and `measurement` modules so tests can inspect/mutate state.
// No-op in production.
if (window.__playwrightTest) {
  window.__world = world;
  window.__dom = dom;
  window.__ar = ar;
  // measurementApi vira disponível apenas após bootstrap() resolver.
  // Tests que dependem dele já esperam pelo painel renderizar (sinal que main.js terminou).
  Object.defineProperty(window, "__measurement", { get: () => measurementApi });
  Object.defineProperty(window, "__volume", { get: () => volumeApi });
}
