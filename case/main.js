// case/main.js
// Composition root: reads UID from URL, fetches GLB from R2, mounts scene, renders panel.
// On R2 miss, probes the Sketchfab API and either redirects to ./legacy/ (Sketchfab has it)
// or shows the "ask the radiologist to upload" overlay (neither system has it).

import * as world from "./world.js";
import * as loader from "./loader.js";
import * as dom from "./dom.js";
import * as measurement from "./measurement.js";
import * as volume from "./volume.js";
import * as calibre from "./calibre.js";
import * as contour from "./contour.js";
import * as ar from "./ar.js";
import * as color from "./color.js";
import { initTheme, toggleTheme, onThemeChange } from "../theme.js";

let measurementApi = null;
let volumeApi = null;
let calibreApi = null;
let contourApi = null;
let rail = null;
let fab = null;
let colorPicker = null;

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("id");

  const canvas = document.getElementById("canvas");
  world.init(canvas);

  if (!uid) {
    dom.showError("Nenhum caso foi informado neste link. Para abrir um caso, adicione ?id=SEU_ID ao final da URL.");
    return;
  }

  dom.showLoading(true);
  const url = await loader.resolveGlbUrl(uid);

  let root, byteLength;
  try {
    ({ root, byteLength } = await loader.loadGlb(url));
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      // R2 doesn't have this uid. Before showing an error, ask Sketchfab —
      // legacy cases live there and the upload page links to /case/?id=...
      // regardless of which backend owns the model.
      const inSketchfab = await loader.probeSketchfab(uid);
      if (inSketchfab) {
        // window.location.replace keeps the broken /case/?id=... out of history,
        // so the back button skips it.
        window.location.replace("./legacy/" + window.location.search);
        return;
      }
      dom.showLoading(false);
      dom.showError("Caso não encontrado no sistema. Solicite ao radiologista responsável que faça o upload do caso.");
      return;
    }
    dom.showLoading(false);
    if (e.code === "PARSE") {
      dom.showError("Arquivo do modelo está corrompido. Contate o suporte.");
    } else {
      dom.showError("Erro ao carregar o modelo. Verifique sua conexão e tente novamente.");
    }
    return;
  }

  world.mount(root);
  world.frameToScene();

  // Barra à esquerda do palco: Medir (abre os três modos) + Cortar, e
  // Desfazer depois do primeiro corte. Uma ferramenta por vez. No celular a
  // mesma barra vira o rodapé, com Estruturas (abre/fecha a gaveta) na frente.
  rail = dom.mountToolRail({
    onContour: () => { menu.close(); contourApi.toggle(); },
    onUndo: () => contourApi.undo(),
    onStructures: () => { menu.close(); setSheet(!sheetOpen); },
  });

  // Gaveta de estruturas no celular: abre com o caso, como antes. Medir e
  // Cortar precisam do modelo inteiro, então ela fecha ao entrar num modo e
  // volta como estava ao sair — menos depois de um corte, que precisa ser visto.
  const mobile = window.matchMedia("(max-width: 768px)");
  let sheetOpen = true;
  let sheetBeforeMode = true;
  const setSheet = (open) => {
    sheetOpen = open;
    dom.setSheetOpen(open);
    rail.setSheetOpen(open);
  };
  // Sem checar a largura aqui: no desktop fechar a gaveta não tem efeito
  // (CSS), e assim girar o aparelho no meio de um modo não desencontra o
  // estado. `mobile` só decide o que é mostrado.
  const enterMode = () => {
    sheetBeforeMode = sheetOpen;
    setSheet(false);
  };
  const exitMode = (keepClosed = false) => {
    if (!keepClosed) setSheet(sheetBeforeMode);
  };
  const exitMeasure = () => { rail.setActive(null); exitMode(); };

  // Barra do modo Cortar (só aparece no celular).
  const modeBar = dom.mountModeBar({
    onCancel: () => contourApi.cancel(),
    onUndo: () => contourApi.undo(),
  });

  // O botão Medir da barra (data-testid="measure-fab") abre o menu dos modos.
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
    onExit: exitMeasure,
  });

  volumeApi = volume.init({
    world,
    dom,
    hint,
    onExit: exitMeasure,
  });

  calibreApi = calibre.init({
    world,
    dom,
    hint,
    onExit: exitMeasure,
  });

  contourApi = contour.init({
    world,
    dom,
    hint,
    labelFor: dom.displayLabel,
    onStateChange: (active, info) => {
      rail.setActive(active ? "contour" : null);
      if (active) {
        enterMode();
        modeBar.show();
      } else {
        modeBar.hide();
        exitMode(info?.applied);
      }
    },
    onHistoryChange: ({ canUndo, cutNames, count }) => {
      rail.setCutControlsVisible(canUndo);
      modeBar.setCount(count);
      for (const name of world.getMeshNames()) dom.setStructureCut(name, cutNames.has(name));
      // O USDZ do AR no iPhone é gerado a partir da cena atual e memoizado.
      ar.invalidateUSDZ();
    },
  });

  // Entrar num modo de medida esconde o aviso "Parte removida · Desfazer":
  // ele ocupa o mesmo lugar da toolbar do modo, e um clique ali desfaria o
  // recorte sem querer.
  const startMeasure = (startFn) => {
    contourApi.hideToast();
    enterMode();
    rail.setActive("measure");
    startFn();
  };
  const menu = dom.mountMeasurementMenu({
    anchorEl: fab.getElement(),
    placement: "right",
    onPickLinear: () => startMeasure(() => measurementApi.startLinear()),
    onPickVolume: () => startMeasure(() => volumeApi.startVolume()),
    onPickCalibre: () => startMeasure(() => calibreApi.startCalibre()),
  });

  fab.setVisible(true);
  rail.show();

  const structures = world.getMeshNames().map((name) => ({
    name,
    color: world.getMeshColor(name),
  }));

  // Popover de cor — uma única instância DOM reusada por todas as linhas.
  // `onPick` é chamado ao vivo (inclusive durante o arraste no seletor
  // nativo), então a malha repinta em tempo real na cena.
  colorPicker = color.mountColorPicker({
    onPick: (name, hex) => {
      if (world.setMeshColor(name, hex)) dom.setSwatchColor(name, hex);
    },
  });

  dom.renderStructures(structures, {
    onColorClick: (name, anchorEl) => {
      colorPicker.openFor({
        anchorEl,
        name,
        currentHex: world.getMeshColor(name),
        originalHex: world.getMeshOriginalColor(name),
      });
    },
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
      if (calibreApi) calibreApi.onMeshVisibilityChange(name, visible);
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
  // Com o Contorno ativo a câmera fica parada: o traço é em coordenadas de tela.
  const zoom = (f) => { if (contourApi?.isActive()) return; world.zoomBy(f); updateZoomPct(); };
  wireAction("zoom-in", () => zoom(1.2));
  wireAction("zoom-out", () => zoom(1 / 1.2));
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

// A mecânica do tema (chave, persistência, troca) mora em ../theme.js, que a
// tela de upload também usa. Aqui só a parte que é do visualizador: o Three.js
// não reage a variáveis CSS, então lemos --w-canvas-bg a cada troca e
// empurramos o hex para a cor de fundo da cena. Manter o renderer opaco (em
// vez de transparente) preserva o blending correto de malhas translúcidas —
// ver commit d20a0cd.
onThemeChange(() => {
  const cssBg = getComputedStyle(document.documentElement)
    .getPropertyValue("--w-canvas-bg")
    .trim();
  if (cssBg) world.setSceneBackground(cssBg);
});

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
  Object.defineProperty(window, "__calibre", { get: () => calibreApi });
  Object.defineProperty(window, "__contour", { get: () => contourApi });
  Object.defineProperty(window, "__colorPicker", { get: () => colorPicker });
}
