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

function bindRedesignChrome(structures, uid, _byteLength) {
  const uidShort = uid.slice(0, 8);
  setBind("uid-short", uidShort);
  setBind("structure-count", String(structures.length));

  // Top bar
  wireAction("share", openShareModal);
  wireAction("theme-toggle", toggleTheme);
  initOverflowMenu();

  // Share modal
  wireAction("share-close", closeShareModal);
  wireAction("share-copy", copyShareLink);
  const scrim = document.querySelector('[data-testid="share-modal"]');
  if (scrim) {
    scrim.addEventListener("click", (e) => { if (e.target === scrim) closeShareModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !scrim.hasAttribute("hidden")) closeShareModal();
    });
  }
  const linkInput = document.querySelector('[data-bind="share-link"]');
  if (linkInput) linkInput.value = window.location.href;

  // Stage zoom
  wireAction("zoom-in", () => { world.zoomBy(1.2); updateZoomPct(); });
  wireAction("zoom-out", () => { world.zoomBy(1 / 1.2); updateZoomPct(); });
  world.onCameraChange(updateZoomPct);
  updateZoomPct();

  // Persisted theme
  initTheme();
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

const THEME_STORAGE_KEY = "medcase-viewer-theme";

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch (_) {}
  setTheme(saved === "dark" ? "dark" : "light");
}

function toggleTheme() {
  const next = (document.documentElement.getAttribute("data-theme") === "dark") ? "light" : "dark";
  setTheme(next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (_) {}
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // Icon swap (sun ↔ moon) lives in CSS — keyed off html[data-theme="dark"].
  // Three.js can't react to CSS vars on its own, so we read --w-canvas-bg
  // (which the CSS variables block updates per html[data-theme]) and push
  // that hex into the scene's clear color. Keeping the renderer opaque
  // (rather than transparent) preserves correct blending for translucent
  // meshes — see commit d20a0cd.
  const cssBg = getComputedStyle(document.documentElement)
    .getPropertyValue("--w-canvas-bg")
    .trim();
  if (cssBg) world.setSceneBackground(cssBg);
}

// Mobile overflow popover — hamburger pill opens a menu with theme + share.
function initOverflowMenu() {
  const toggle = document.querySelector('[data-testid="overflow-toggle"]');
  const menu = document.querySelector('[data-testid="overflow-menu"]');
  if (!toggle || !menu) return;

  const position = () => {
    const r = toggle.getBoundingClientRect();
    if (!r.width && !r.height) {
      // Fallback before the toggle is laid out.
      menu.style.top = "62px";
      menu.style.left = "16px";
      menu.style.right = "auto";
      return;
    }
    menu.style.top = (r.bottom + 8) + "px";
    // The hamburger lives on the LEFT of the mobile top bar, so anchor the
    // menu's left edge to the toggle's left edge (it opens rightward into
    // the viewport). If the menu would overflow the right edge, clamp it
    // back so it stays inside the visible area with an 8px margin.
    const menuW = menu.offsetWidth || 240;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const margin = 8;
    let left = r.left;
    if (left + menuW > vw - margin) left = Math.max(margin, vw - menuW - margin);
    menu.style.left = left + "px";
    menu.style.right = "auto";
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = menu.dataset.open !== "true";
    menu.dataset.open = next ? "true" : "false";
    toggle.setAttribute("aria-expanded", String(next));
    if (next) position();
  });

  // Each menu item triggers its data-action (already wired) and closes the
  // popover. The item's data-action also fires the existing handler via
  // querySelectorAll('[data-action]') in wireAction.
  menu.querySelectorAll(".overflow-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  // Outside-click + Escape close the popover.
  document.addEventListener("pointerdown", (e) => {
    if (menu.dataset.open !== "true") return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    menu.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.dataset.open === "true") {
      menu.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("resize", () => {
    if (menu.dataset.open === "true") position();
  });
}

function openShareModal() {
  const scrim = document.querySelector('[data-testid="share-modal"]');
  if (!scrim) return;
  scrim.removeAttribute("hidden");
  const close = scrim.querySelector('[data-action="share-close"]');
  if (close) close.focus();
}

function closeShareModal() {
  const scrim = document.querySelector('[data-testid="share-modal"]');
  if (scrim) scrim.setAttribute("hidden", "");
}

async function copyShareLink() {
  const input = document.querySelector('[data-bind="share-link"]');
  const url = input?.value || window.location.href;
  try {
    await navigator.clipboard?.writeText(url);
  } catch {
    if (input) {
      input.removeAttribute("readonly");
      input.select();
      try { document.execCommand("copy"); } catch {}
      input.setAttribute("readonly", "");
    }
  }
  const btn = document.querySelector('[data-action="share-copy"]');
  const lbl = btn?.querySelector(".link-copy-label");
  if (btn && lbl) {
    btn.classList.add("ok");
    const prev = lbl.textContent;
    lbl.textContent = "Copiado";
    setTimeout(() => {
      btn.classList.remove("ok");
      lbl.textContent = prev;
    }, 1600);
  }
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
