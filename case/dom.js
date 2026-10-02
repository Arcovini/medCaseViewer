// case/dom.js
// UI helpers: structures panel, loading and error overlays.
// Knows nothing about Three.js beyond the structure name (string) and color (hex string).

const list = document.getElementById("structures-list");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

const EYE_ON = "./eye_icon.svg";
const EYE_OFF = "./eye_off_icon.svg";

// O GLTFLoader do Three.js sanitiza nomes de nó (PropertyBinding.sanitizeNodeName)
// trocando espaços por "_", para não quebrar o binding de animação. O backend
// grava nomes com espaço ("Tumor dentro de Rim", "arteria renal"), então sem
// isto o painel mostraria "Tumor_dentro_de_Rim". O nome sanitizado continua
// sendo o identificador (dataset, lookups, world.js); só o texto visível muda.
export const displayLabel = (name) => name.replace(/_/g, " ");

export function showLoading(visible) {
  loadingEl.hidden = !visible;
}

export function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

export function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

export function renderStructures(structures, callbacks) {
  const { onToggle, onOpacityChange, onColorClick } = callbacks;
  list.innerHTML = "";

  for (const { name, color } of structures) {
    const label = displayLabel(name);
    const li = document.createElement("li");
    li.dataset.structureName = name;
    if (color) li.style.setProperty("--struct-color", color);

    // Linha 1: swatch + nome + olho
    const rowMain = document.createElement("div");
    rowMain.className = "structure-row-main";

    // A barrinha colorida à esquerda da linha é o botão de troca de cor.
    // Só existe pra malha de cor chapada — a texturizada não tem cor editável
    // (world.getMeshColor devolve null), então a linha fica sem faixa.
    if (color && onColorClick) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "struct-swatch";
      swatch.dataset.structureName = name;
      swatch.dataset.testid = "struct-swatch";
      swatch.setAttribute("aria-label", `Alterar cor de ${label}`);
      swatch.setAttribute("aria-haspopup", "dialog");
      swatch.setAttribute("aria-expanded", "false");
      swatch.title = "Alterar cor";
      swatch.innerHTML = `<span class="struct-swatch-bar"></span>`;
      swatch.addEventListener("click", () => onColorClick(name, swatch));
      li.appendChild(swatch);
    } else if (color) {
      // Sem handler de cor (ex.: testes que montam o painel isolado) a faixa
      // continua sendo desenhada, só que inerte.
      const bar = document.createElement("span");
      bar.className = "struct-swatch struct-swatch-static";
      bar.innerHTML = `<span class="struct-swatch-bar"></span>`;
      li.appendChild(bar);
    }

    const labelEl = document.createElement("span");
    labelEl.className = "structure-name";
    labelEl.textContent = label;
    labelEl.title = label; // nomes de divisão são longos e o painel trunca com ellipsis

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eye-toggle";
    btn.dataset.visible = "true";
    btn.dataset.structureName = name;

    const img = document.createElement("img");
    img.src = EYE_ON;
    img.alt = "Visível";
    btn.appendChild(img);

    btn.addEventListener("click", () => {
      const nowVisible = btn.dataset.visible !== "true";
      btn.dataset.visible = String(nowVisible);
      img.src = nowVisible ? EYE_ON : EYE_OFF;
      img.alt = nowVisible ? "Visível" : "Oculto";
      onToggle(name, nowVisible);
    });

    rowMain.appendChild(labelEl);
    rowMain.appendChild(btn);

    // Linha 2: slider
    const rowOpacity = document.createElement("div");
    rowOpacity.className = "opacity-row";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = "1";
    slider.className = "opacity-slider";
    slider.dataset.structureName = name;
    slider.setAttribute("aria-label", `Opacidade de ${label}`);

    slider.addEventListener("input", () => {
      onOpacityChange(name, parseFloat(slider.value));
    });

    rowOpacity.appendChild(slider);

    // Aviso persistente de que o Contorno tirou parte desta estrutura. Sem ele
    // o médico pode esquecer que está olhando um modelo incompleto.
    const cutNote = document.createElement("span");
    cutNote.className = "structure-cut-note";
    cutNote.dataset.structureName = name;
    cutNote.textContent = "Parte removida";
    cutNote.hidden = true;

    li.appendChild(rowMain);
    li.appendChild(cutNote);
    li.appendChild(rowOpacity);
    list.appendChild(li);
  }
}

export function setEyeState(name, visible) {
  const btn = list.querySelector(`.eye-toggle[data-structure-name="${CSS.escape(name)}"]`);
  if (!btn) return;
  btn.dataset.visible = String(visible);
  const img = btn.querySelector("img");
  if (img) {
    img.src = visible ? EYE_ON : EYE_OFF;
    img.alt = visible ? "Visível" : "Oculto";
  }
}

// A faixa colorida lê `--struct-color` do <li>, então trocar a variável
// atualiza o swatch sem tocar em nenhum outro nó.
export function setSwatchColor(name, hex) {
  const li = list.querySelector(`li[data-structure-name="${CSS.escape(name)}"]`);
  if (!li) return;
  li.style.setProperty("--struct-color", hex);
}

// Gaveta de estruturas aberta/fechada. Só tem efeito no celular (CSS); no
// desktop o painel é uma coluna fixa.
export function setSheetOpen(open) {
  const panel = document.getElementById("structures-panel");
  if (panel) panel.dataset.open = String(open);
}

export function setStructureCut(name, cut) {
  const note = list.querySelector(`.structure-cut-note[data-structure-name="${CSS.escape(name)}"]`);
  if (note) note.hidden = !cut;
}

export function setSliderValue(name, value) {
  const slider = list.querySelector(`.opacity-slider[data-structure-name="${CSS.escape(name)}"]`);
  if (!slider) return;
  slider.value = String(value);
  // Não disparamos `input` event intencionalmente. Esta função é chamada pelo caller
  // quando ele já atualizou world.setOpacity — disparar o evento causaria um loop de callback.
}

// === Bottom sheet (mobile only) ===

const SNAP_COLLAPSED_VH = 30;
const SNAP_EXPANDED_VH = 80;
const MOBILE_BREAKPOINT = 768;

let _panelEl = null;
let _handleEl = null;
let _isDragging = false;
let _dragStartY = 0;
let _dragStartHeightPx = 0;

export function initBottomSheet() {
  _panelEl = document.querySelector(".panel");
  _handleEl = _panelEl?.querySelector(".panel-handle");
  if (!_panelEl || !_handleEl) return;

  _handleEl.addEventListener("touchstart", _onDragStart, { passive: false });
  _handleEl.addEventListener("mousedown", _onDragStart);

  // Sair do modo mobile (rotação ou resize) limpa o height customizado
  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      _panelEl.style.removeProperty("--panel-height");
    }
  });
}

// Altura máxima da gaveta, em vh: a gaveta se apoia no rodapé (bottom =
// --mbar-h) e não pode subir por cima da barra do topo (56px).
function _maxSheetVh() {
  const bottom = parseFloat(getComputedStyle(_panelEl).bottom) || 0;
  return ((window.innerHeight - bottom - 56) / window.innerHeight) * 100;
}

function _onDragStart(e) {
  if (window.innerWidth > MOBILE_BREAKPOINT) return;

  _isDragging = true;
  const point = e.touches ? e.touches[0] : e;
  _dragStartY = point.clientY;
  _dragStartHeightPx = _panelEl.getBoundingClientRect().height;

  _panelEl.classList.add("is-dragging");

  document.addEventListener("touchmove", _onDragMove, { passive: false });
  document.addEventListener("mousemove", _onDragMove);
  document.addEventListener("touchend", _onDragEnd);
  document.addEventListener("mouseup", _onDragEnd);
  document.addEventListener("touchcancel", _onDragEnd);

  e.preventDefault();
}

function _onDragMove(e) {
  if (!_isDragging) return;

  const point = e.touches ? e.touches[0] : e;
  const deltaY = _dragStartY - point.clientY;   // arrastar pra cima → positivo
  const newHeightPx = _dragStartHeightPx + deltaY;
  const newHeightVh = (newHeightPx / window.innerHeight) * 100;
  const clamped = Math.max(15, Math.min(_maxSheetVh(), newHeightVh));

  _panelEl.style.setProperty("--panel-height", `${clamped}vh`);

  e.preventDefault();
}

function _onDragEnd() {
  if (!_isDragging) return;
  _isDragging = false;

  _panelEl.classList.remove("is-dragging");

  const currentHeightVh = (_panelEl.getBoundingClientRect().height / window.innerHeight) * 100;
  const midpoint = (SNAP_COLLAPSED_VH + SNAP_EXPANDED_VH) / 2;
  const snapTo = currentHeightVh > midpoint ? Math.min(SNAP_EXPANDED_VH, _maxSheetVh()) : SNAP_COLLAPSED_VH;
  _panelEl.style.setProperty("--panel-height", `${snapTo}vh`);

  document.removeEventListener("touchmove", _onDragMove);
  document.removeEventListener("mousemove", _onDragMove);
  document.removeEventListener("touchend", _onDragEnd);
  document.removeEventListener("mouseup", _onDragEnd);
  document.removeEventListener("touchcancel", _onDragEnd);
}

// ===========================================================================
// Sprint 3b.2 — Medição linear (DOM primitives)
// ===========================================================================

// Botão Medir, compartilhado pelos três modos. Vive na barra de ferramentas à
// esquerda do palco (markup estático, `data-testid="measure-fab"`). O click
// abre o popover do menu (main.js cuida disso). Durante um modo ativo ele fica
// pressionado e travado (mountToolRail.setActive); a saída é pela toolbar
// inferior do modo.
export function mountMeasurementFAB({ onClick }) {
  const btn = document.querySelector('[data-testid="measure-fab"]');
  btn.addEventListener("click", onClick);

  return {
    setVisible(visible) {
      if (visible) btn.removeAttribute("hidden");
      else btn.setAttribute("hidden", "");
    },
    getElement() { return btn; },
  };
}

const _MENU_ICON_RULER = `<path d="M3 12 L7 8 L21 8 L21 16 L7 16 Z"/><path d="M9 8 L9 12 M13 8 L13 12 M17 8 L17 12"/>`;
const _MENU_ICON_CUBE = `<path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z"/><path d="M3 8 L12 13 L21 8 M12 13 L12 21"/>`;
const _MENU_ICON_CALIBRE = `<circle cx="12" cy="12" r="6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`;

// `placement: "right"` abre o menu ao lado da âncora (botão da barra de
// ferramentas à esquerda do palco); o padrão abre abaixo, alinhado à direita.
export function mountMeasurementMenu({ anchorEl, placement = "below", onPickLinear, onPickVolume, onPickCalibre }) {
  const wrapper = document.createElement("div");
  wrapper.className = "measure-menu";
  wrapper.dataset.open = "false";
  wrapper.dataset.testid = "measure-menu";
  wrapper.innerHTML = `
    <button type="button" class="measure-menu-item" data-tool="linear" data-testid="menu-linear">
      <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${_MENU_ICON_RULER}</svg></span>
      <span class="lbl"><span class="l1">Linear</span><span class="l2">2 pontos · mm</span></span>
    </button>
    <button type="button" class="measure-menu-item" data-tool="volume" data-testid="menu-volume">
      <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${_MENU_ICON_CUBE}</svg></span>
      <span class="lbl"><span class="l1">Volume</span><span class="l2">3D · cm³</span></span>
    </button>
    <button type="button" class="measure-menu-item" data-tool="calibre" data-testid="menu-calibre">
      <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${_MENU_ICON_CALIBRE}</svg></span>
      <span class="lbl"><span class="l1">Calibre</span><span class="l2">vaso · mm</span></span>
    </button>
  `;
  document.body.appendChild(wrapper);

  function positionMenu() {
    if (!anchorEl) return;
    // No celular o menu é uma folha acima da barra do rodapé (CSS).
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      wrapper.style.top = "";
      wrapper.style.left = "";
      wrapper.style.right = "";
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    // Align the menu's right edge to the anchor's right edge, 8px below.
    // Fallback to top:72/right:16 if the anchor isn't laid out yet.
    if (r.width === 0 && r.height === 0) {
      wrapper.style.top = "72px";
      wrapper.style.right = "16px";
      wrapper.style.left = "auto";
      return;
    }
    if (placement === "right") {
      wrapper.style.top = r.top + "px";
      wrapper.style.left = (r.right + 12) + "px";
    } else {
      wrapper.style.top = (r.bottom + 8) + "px";
      wrapper.style.left = (r.right - wrapper.offsetWidth) + "px";
    }
    wrapper.style.right = "auto";
  }
  window.addEventListener("resize", () => {
    if (wrapper.dataset.open === "true") positionMenu();
  });

  document.addEventListener("pointerdown", (e) => {
    if (wrapper.dataset.open !== "true") return;
    if (wrapper.contains(e.target)) return;
    if (anchorEl && anchorEl.contains(e.target)) return;
    wrapper.dataset.open = "false";
    _syncAnchorExpanded(anchorEl, false);
  });

  wrapper.querySelector('[data-tool="linear"]').addEventListener("click", () => {
    wrapper.dataset.open = "false";
    _syncAnchorExpanded(anchorEl, false);
    onPickLinear();
  });
  wrapper.querySelector('[data-tool="volume"]').addEventListener("click", () => {
    wrapper.dataset.open = "false";
    _syncAnchorExpanded(anchorEl, false);
    onPickVolume();
  });
  wrapper.querySelector('[data-tool="calibre"]').addEventListener("click", () => {
    wrapper.dataset.open = "false";
    _syncAnchorExpanded(anchorEl, false);
    if (onPickCalibre) onPickCalibre();
  });

  return {
    open()   { wrapper.dataset.open = "true";  _syncAnchorExpanded(anchorEl, true); positionMenu(); },
    close()  { wrapper.dataset.open = "false"; _syncAnchorExpanded(anchorEl, false); },
    toggle() {
      const next = wrapper.dataset.open !== "true";
      wrapper.dataset.open = next ? "true" : "false";
      _syncAnchorExpanded(anchorEl, next);
      if (next) positionMenu();
    },
    isOpen() { return wrapper.dataset.open === "true"; },
  };
}

function _syncAnchorExpanded(el, open) {
  if (el && el.hasAttribute("aria-haspopup")) {
    el.setAttribute("aria-expanded", String(open));
  }
}

export function mountHintBanner() {
  const el = document.createElement("div");
  el.className = "measure-hint";
  el.dataset.testid = "measure-hint";
  el.hidden = true;
  document.body.appendChild(el);

  return {
    setText(text) {
      el.textContent = text;
      el.hidden = false;
    },
    clear() {
      el.textContent = "";
      el.hidden = true;
    },
  };
}

export function mountMiniToolbar({ onConfirm, onCancel, onClear, onNew }) {
  const el = document.createElement("div");
  el.className = "measure-toolbar";
  el.dataset.testid = "measure-toolbar";
  el.hidden = true;
  document.body.appendChild(el);

  function makeBtn(label, klass, onClick, testid) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klass;
    b.textContent = label;
    b.dataset.testid = testid;
    b.addEventListener("click", onClick);
    return b;
  }

  return {
    showConfirmRow(label) {
      // "Tentar de novo" foi removido: re-tocar em outra posição já substitui
      // o candidato. "✕ Cancelar" no toolbar substitui o FAB-cancel do top-right
      // pra liberar a área do hint banner em mobile.
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Cancelar", "btn-secondary", onCancel, "btn-cancel"));
      el.appendChild(makeBtn(`✓ Confirmar ${label}`, "btn-primary", onConfirm, "btn-confirm"));
      el.hidden = false;
    },
    showResultRow() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Limpar", "btn-secondary", onClear, "btn-clear"));
      el.appendChild(makeBtn("+ Nova", "btn-primary", onNew, "btn-new"));
      el.hidden = false;
    },
    hide() {
      el.innerHTML = "";
      el.hidden = true;
    },
  };
}

// ===========================================================================
// AR — botão pill + modal QR
// ===========================================================================

export function mountARButton({ onClick }) {
  // Pós-v5 o AR pill vive como `.pill.ar-button` no top bar do markup
  // estático (com `data-testid="ar-button"`). Reusa-o se existir; senão
  // cria um botão flutuante (cobre /case/ legado e ambientes de teste
  // que carregam ar.js sem o shell completo).
  let btn = document.querySelector('[data-testid="ar-button"]');
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ar-button";
    btn.dataset.visible = "false";
    btn.dataset.loading = "false";
    btn.dataset.testid = "ar-button";
    btn.setAttribute("aria-label", "Ver em AR");
    btn.textContent = "AR";
    document.body.appendChild(btn);
  }
  btn.addEventListener("click", () => {
    if (btn.dataset.loading === "true") return;
    onClick();
  });

  return {
    setVisible(v) { btn.dataset.visible = v ? "true" : "false"; },
    setLoading(v) { btn.dataset.loading = v ? "true" : "false"; },
  };
}

export function mountARModal({ onClose } = {}) {
  const modal = document.createElement("div");
  modal.className = "ar-modal";
  modal.dataset.visible = "false";
  modal.dataset.testid = "ar-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "ar-modal-title");

  modal.innerHTML = `
    <div class="ar-modal-content">
      <button class="ar-modal-close" type="button" aria-label="Fechar" data-testid="ar-modal-close">×</button>
      <div class="ar-modal-qr"><img alt="QR code para abrir o caso no celular" /></div>
      <p id="ar-modal-title">Aponte a câmera do celular para o código.</p>
    </div>
  `;

  document.body.appendChild(modal);

  const imgEl = modal.querySelector(".ar-modal-qr img");
  const closeBtn = modal.querySelector(".ar-modal-close");

  let _previousFocus = null;

  function show(qrDataUrl) {
    _previousFocus = document.activeElement;
    imgEl.src = qrDataUrl;
    modal.dataset.visible = "true";
    closeBtn.focus();
  }

  function hide() {
    if (modal.dataset.visible !== "true") return;
    modal.dataset.visible = "false";
    if (_previousFocus && typeof _previousFocus.focus === "function") {
      _previousFocus.focus();
    }
    if (onClose) onClose();
  }

  closeBtn.addEventListener("click", hide);
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.dataset.visible === "true") hide();
  });

  return {
    showWithQR: show,
    hide,
  };
}

// Convite "Ver em AR" em tela cheia, para o caso aberto pelo QR (…&ar=1) no
// celular. Estados em data-state: "loading" (preparando; botão travado),
// "ready" e "unsupported" (aparelho sem AR: só o aviso e a volta ao 3D).
// "Ver o modelo 3D" está sempre disponível — o convite nunca prende ninguém.
const AR_PROMPT_COPY = {
  loading: {
    title: "Realidade aumentada",
    text: "Preparando o modelo para a câmera do seu aparelho.",
    open: "Preparando…",
  },
  ready: {
    title: "Realidade aumentada",
    text: "Veja o modelo em tamanho real no ambiente à sua volta.",
    open: "Ver em AR",
  },
  unsupported: {
    title: "Realidade aumentada indisponível",
    text: "Este aparelho não abre realidade aumentada pelo navegador. Você pode explorar o modelo em 3D.",
    open: "",
  },
};

export function mountARPrompt({ onOpen, onDismiss }) {
  const el = document.createElement("div");
  el.className = "ar-prompt";
  el.dataset.visible = "false";
  el.dataset.testid = "ar-prompt";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "ar-prompt-title");
  el.innerHTML = `
    <div class="ar-prompt-card">
      <h2 class="ar-prompt-title" id="ar-prompt-title"></h2>
      <p class="ar-prompt-text"></p>
      <button type="button" class="btn btn-primary btn-lg btn-block" data-testid="ar-prompt-open"></button>
      <button type="button" class="btn btn-ghost btn-lg btn-block" data-testid="ar-prompt-dismiss">Ver o modelo 3D</button>
    </div>
  `;
  document.body.appendChild(el);

  const titleEl = el.querySelector(".ar-prompt-title");
  const textEl = el.querySelector(".ar-prompt-text");
  const openBtn = el.querySelector('[data-testid="ar-prompt-open"]');
  const dismissBtn = el.querySelector('[data-testid="ar-prompt-dismiss"]');

  function setState(state) {
    const copy = AR_PROMPT_COPY[state];
    el.dataset.state = state;
    titleEl.textContent = copy.title;
    textEl.textContent = copy.text;
    openBtn.textContent = copy.open;
    openBtn.hidden = state === "unsupported";
    openBtn.disabled = state !== "ready";
  }

  openBtn.addEventListener("click", () => { if (!openBtn.disabled) onOpen(); });
  dismissBtn.addEventListener("click", () => onDismiss());

  return {
    show(state) { setState(state); el.dataset.visible = "true"; },
    setState,
    hide() { el.dataset.visible = "false"; },
  };
}

// Uma lupa só na página: o WebGLRenderer dela (world.attachLoupeCanvas) só
// aceita um canvas, e Linear, Calibre e Cortar nunca estão ativos juntos.
let _loupeInstance = null;

export function mountLoupe() {
  if (_loupeInstance) return _loupeInstance;
  const wrapper = document.createElement("div");
  wrapper.className = "measure-loupe";
  wrapper.dataset.testid = "measure-loupe";
  wrapper.dataset.visible = "false";
  wrapper.innerHTML = `
    <div class="measure-loupe-frame">
      <canvas class="measure-loupe-canvas" width="100" height="100"></canvas>
      <div class="measure-loupe-crosshair"></div>
      <div class="measure-loupe-label" hidden></div>
    </div>
    <div class="measure-loupe-tail"></div>
  `;
  document.body.appendChild(wrapper);

  const canvas = wrapper.querySelector(".measure-loupe-canvas");
  const labelEl = wrapper.querySelector(".measure-loupe-label");

  return _loupeInstance = {
    canvas,
    setPosition(x, y) {
      // Lupa fica acima do candidato por padrão; se < 120px do topo, flipa pra baixo.
      const flip = y < 120;
      wrapper.dataset.flip = flip ? "below" : "above";
      wrapper.style.left = `${x}px`;
      wrapper.style.top = `${flip ? y + 16 : y - 16}px`;
    },
    setLabel(text) {
      if (text) {
        // Recebe o nome da malha; mesma dessanitização do painel de estruturas.
        labelEl.textContent = displayLabel(text);
        labelEl.hidden = false;
      } else {
        labelEl.hidden = true;
      }
    },
    setVisible(visible) {
      wrapper.dataset.visible = String(visible);
    },
  };
}

// ===========================================================================
// Sprint 3b.3 — Medição de volume (toolbar bottom-center: Sair / +Nova)
// ===========================================================================

// ===========================================================================
// Sprint 3b.4 — Medição de calibre (vessel diameter)
// ===========================================================================

// Toolbar do modo Calibre. Variantes:
//   cancelOnly()       — durante PLACING_P1, EXTRACTING_CL, READY_*
//   confirmRow(label)  — durante CANDIDATE_P1 / CANDIDATE_P2
//   resultRow()        — durante CIRCLE_PLACED (antes do pin)
//   committedRow()     — após pin, permitindo + Nova ou sair
export function mountCalibreToolbar({ onCancel, onConfirm, onNew, onExit }) {
  const el = document.createElement("div");
  el.className = "measure-toolbar";
  el.dataset.testid = "calibre-toolbar";
  el.hidden = true;
  document.body.appendChild(el);

  function makeBtn(label, klass, onClick, testid) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klass;
    b.textContent = label;
    b.dataset.testid = testid;
    b.addEventListener("click", onClick);
    return b;
  }

  return {
    showCancelOnly() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Cancelar", "btn-secondary", onCancel, "btn-calibre-cancel"));
      el.hidden = false;
    },
    showConfirmRow(label) {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Cancelar", "btn-secondary", onCancel, "btn-calibre-cancel"));
      el.appendChild(makeBtn(`✓ Confirmar ${label}`, "btn-primary", onConfirm, "btn-calibre-confirm"));
      el.hidden = false;
    },
    showResultRow() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Cancelar", "btn-secondary", onCancel, "btn-calibre-cancel"));
      el.appendChild(makeBtn("✓ Confirmar", "btn-primary", onConfirm, "btn-calibre-confirm"));
      el.hidden = false;
    },
    showCommittedRow() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Sair", "btn-secondary", onExit, "btn-calibre-exit"));
      el.appendChild(makeBtn("+ Nova", "btn-primary", onNew, "btn-calibre-new"));
      el.hidden = false;
    },
    hide() {
      el.innerHTML = "";
      el.hidden = true;
    },
  };
}

// ===========================================================================
// Barra de ferramentas à esquerda do palco (Medir + Contorno) e Contorno
// ===========================================================================

// A barra é markup estático do index.html; aqui só o comportamento.
export function mountToolRail({ onContour, onUndo, onStructures }) {
  const rail = document.querySelector('[data-testid="tool-rail"]');
  const measureBtn = rail.querySelector('[data-testid="measure-fab"]');
  const contourBtn = rail.querySelector('[data-testid="contour-button"]');
  const sheetBtn = rail.querySelector('[data-testid="sheet-toggle"]');
  const cutEls = rail.querySelectorAll('[data-rail="cut"]');

  contourBtn.addEventListener("click", onContour);
  rail.querySelector('[data-testid="cut-undo"]').addEventListener("click", onUndo);
  if (sheetBtn && onStructures) sheetBtn.addEventListener("click", onStructures);

  return {
    show() { rail.hidden = false; },
    // Botão Estruturas (só existe no celular) acompanha a gaveta.
    setSheetOpen(open) { sheetBtn?.setAttribute("aria-pressed", String(open)); },
    // Uma ferramenta por vez. Medir ativo: os dois botões travam (a saída é
    // pela barra inferior do modo, como antes). Cortar ativo: o próprio
    // botão continua clicável e funciona como "sair".
    setActive(tool) {
      // No celular, a barra do rodapé sai de cena durante um modo (CSS).
      rail.dataset.mode = tool ?? "";
      measureBtn.setAttribute("aria-pressed", String(tool === "measure"));
      contourBtn.setAttribute("aria-pressed", String(tool === "contour"));
      measureBtn.disabled = tool !== null;
      contourBtn.disabled = tool === "measure";
      // Desfazer/Restaurar trocariam a geometria por baixo de uma medida em
      // andamento (pílula de volume, linha central do calibre).
      cutEls.forEach((el) => { if (el.tagName === "BUTTON") el.disabled = tool === "measure"; });
    },
    setCutControlsVisible(visible) {
      cutEls.forEach((el) => { el.hidden = !visible; });
    },
  };
}

// Traço do contorno. SVG fixo do tamanho da viewport: os pontos chegam em
// clientX/clientY e são usados sem conversão.
export function mountContourLayer() {
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(NS, "svg");
  svgEl.setAttribute("class", "contour-layer");
  svgEl.setAttribute("aria-hidden", "true");
  svgEl.dataset.testid = "contour-layer";
  const under = document.createElementNS(NS, "path");
  under.setAttribute("class", "contour-under");
  const line = document.createElementNS(NS, "path");
  line.setAttribute("class", "contour-line");
  svgEl.append(under, line);
  svgEl.hidden = true;
  document.body.appendChild(svgEl);

  return {
    draw(d, closed) {
      under.setAttribute("d", d);
      line.setAttribute("d", d);
      svgEl.dataset.closed = String(closed);
      svgEl.hidden = false;
    },
    clear() {
      under.removeAttribute("d");
      line.removeAttribute("d");
      svgEl.hidden = true;
    },
  };
}

// Cartão que aparece ao fechar o contorno: lista só as estruturas que ele
// cruzou, a área (dentro/fora) e a confirmação. Posicionado junto ao contorno.
export function mountContourCard({ onToggle, onSide, onCancel, onApply }) {
  const card = document.createElement("div");
  card.className = "contour-card";
  card.dataset.testid = "contour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Cortar parte das estruturas");
  card.hidden = true;
  card.innerHTML = `
    <span class="field-label">Cruzam o contorno</span>
    <div class="contour-list" data-testid="contour-list"></div>
    <p class="contour-note">Estruturas que o contorno não cruzou ficam intactas.</p>
    <span class="field-label">Área</span>
    <div class="contour-seg" role="group" aria-label="Área">
      <button type="button" data-side="inside" data-testid="contour-side-inside" aria-pressed="true">Dentro</button>
      <button type="button" data-side="outside" data-testid="contour-side-outside" aria-pressed="false">Fora</button>
    </div>
    <div class="contour-actions">
      <button type="button" class="btn btn-ghost" data-testid="contour-cancel">Cancelar</button>
      <button type="button" class="btn btn-primary" data-testid="contour-apply">Cortar</button>
    </div>
  `;
  document.body.appendChild(card);

  const listEl = card.querySelector(".contour-list");
  const applyBtn = card.querySelector('[data-testid="contour-apply"]');
  const cancelBtn = card.querySelector('[data-testid="contour-cancel"]');
  const sideBtns = card.querySelectorAll("[data-side]");
  let applyEnabled = true;
  let busy = false;

  // Enquanto o corte roda, nada no cartão responde.
  function syncControls() {
    applyBtn.disabled = busy || !applyEnabled;
    applyBtn.textContent = busy ? "Cortando…" : "Cortar";
    cancelBtn.disabled = busy;
    sideBtns.forEach((b) => { b.disabled = busy; });
    listEl.querySelectorAll("input").forEach((i) => { i.disabled = busy; });
  }

  listEl.addEventListener("change", (e) => {
    const input = e.target.closest("input[type=checkbox]");
    if (input) onToggle(input.dataset.structureName, input.checked);
  });
  sideBtns.forEach((b) => b.addEventListener("click", () => {
    sideBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onSide(b.dataset.side);
  }));
  cancelBtn.addEventListener("click", onCancel);
  applyBtn.addEventListener("click", onApply);

  function position(bounds) {
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= MOBILE_BREAKPOINT) {
      // No celular o cartão vira uma gaveta presa ao rodapé (CSS), no lugar
      // da barra: nada flutua em cima do modelo.
      card.style.left = "";
      card.style.top = "";
      return;
    }
    const stage = document.querySelector(".vw-stage")?.getBoundingClientRect()
      ?? { left: 0, top: 0, right: vw, bottom: vh };
    const gap = 16;
    const minLeft = stage.left + 96;          // não cobre a barra de ferramentas
    let left = bounds.minX - w - gap;         // preferência: à esquerda do contorno
    if (left < minLeft) left = bounds.maxX + gap;
    if (left + w > stage.right - 12) left = Math.max(minLeft, stage.right - w - 12);
    const top = Math.min(Math.max(bounds.minY, stage.top + 64), stage.bottom - h - 72);
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  return {
    show({ candidates, bounds, side }) {
      listEl.innerHTML = "";
      for (const c of candidates) {
        const row = document.createElement("label");
        row.className = "contour-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = c.checked;
        input.dataset.structureName = c.name;
        const bar = document.createElement("span");
        bar.className = "contour-bar";
        if (c.color) bar.style.setProperty("--struct-color", c.color);
        const nameEl = document.createElement("span");
        nameEl.className = "contour-name";
        nameEl.textContent = c.label;
        row.append(input, bar, nameEl);
        listEl.appendChild(row);
      }
      sideBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.side === side)));
      card.hidden = false;
      position(bounds);
      applyBtn.focus({ preventScroll: true });
    },
    setApplyEnabled(enabled) { applyEnabled = enabled; syncControls(); },
    setBusy(value) { busy = value; syncControls(); },
    hide() { card.hidden = true; },
    isOpen() { return !card.hidden; },
  };
}

export function mountContourToolbar({ onCancel }) {
  const el = document.createElement("div");
  el.className = "measure-toolbar";
  el.dataset.testid = "contour-toolbar";
  el.hidden = true;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-secondary";
  b.textContent = "✕ Cancelar";
  b.dataset.testid = "contour-toolbar-cancel";
  b.addEventListener("click", onCancel);
  el.appendChild(b);
  document.body.appendChild(el);
  return {
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
  };
}

// Barra do modo Cortar no celular: toma o lugar da barra do rodapé enquanto
// a ferramenta está ligada. Cancelar à esquerda, Desfazer à direita — sempre
// no mesmo lugar. No desktop fica escondida (CSS).
export function mountModeBar({ onCancel, onUndo }) {
  const el = document.createElement("div");
  el.className = "vw-modebar";
  el.dataset.testid = "mode-bar";
  el.dataset.open = "false";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Cortar");
  el.innerHTML = `
    <button type="button" class="btn btn-ghost vw-modebar-cancel" data-testid="mode-cancel">Cancelar</button>
    <div class="vw-modebar-title"><span class="t1">Cortar</span><span class="t2"></span></div>
    <button type="button" class="vw-modebar-undo" data-testid="mode-undo" aria-label="Desfazer o último corte" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
    </button>
  `;
  document.body.appendChild(el);
  const sub = el.querySelector(".t2");
  const undoBtn = el.querySelector('[data-testid="mode-undo"]');
  el.querySelector('[data-testid="mode-cancel"]').addEventListener("click", onCancel);
  undoBtn.addEventListener("click", onUndo);

  function setCount(n) {
    sub.textContent = n === 0 ? "Nada cortado ainda" : n === 1 ? "1 corte feito" : `${n} cortes feitos`;
    undoBtn.disabled = n === 0;
  }
  setCount(0);

  return {
    show() { el.dataset.open = "true"; },
    hide() { el.dataset.open = "false"; },
    setCount,
  };
}

// Aviso curto no rodapé do palco com uma ação (Desfazer). Some sozinho.
export function mountToast() {
  const el = document.createElement("div");
  el.className = "contour-toast";
  el.dataset.testid = "contour-toast";
  el.setAttribute("role", "status");
  el.hidden = true;
  el.innerHTML = `
    <span class="contour-toast-text"></span>
    <button type="button" class="contour-toast-act" data-testid="contour-toast-undo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
      <span>Desfazer</span>
    </button>
  `;
  document.body.appendChild(el);
  const textEl = el.querySelector(".contour-toast-text");
  const actBtn = el.querySelector(".contour-toast-act");
  let onAct = null;
  let timer = null;
  let duration = 8000;
  let held = false; // ponteiro em cima ou foco dentro: o aviso espera
  actBtn.addEventListener("click", () => { if (onAct) onAct(); });

  function hide() {
    clearTimeout(timer);
    el.hidden = true;
    // Sumir sob o ponteiro (ou com o foco no Desfazer) nem sempre dispara
    // pointerleave/focusout: sem isto o próximo aviso ficaria preso na tela.
    held = false;
  }

  // Quem está lendo o aviso (ou indo até o Desfazer) não o vê sumir; ao sair,
  // o prazo recomeça inteiro.
  function arm() {
    clearTimeout(timer);
    if (!held && !el.hidden) timer = setTimeout(hide, duration);
  }
  const hold = (on) => { held = on; arm(); };
  el.addEventListener("pointerenter", () => hold(true));
  el.addEventListener("pointerleave", () => hold(false));
  el.addEventListener("focusin", () => hold(true));
  el.addEventListener("focusout", () => hold(false));

  return {
    show(text, { onAction, timeoutMs = 8000 } = {}) {
      textEl.textContent = text;
      onAct = onAction;
      actBtn.hidden = !onAction;
      el.hidden = false;
      duration = timeoutMs;
      arm();
    },
    hide,
  };
}

export function mountVolumeToolbar({ onNew, onExit }) {
  const el = document.createElement("div");
  el.className = "measure-toolbar";
  el.dataset.testid = "volume-toolbar";
  el.hidden = true;
  document.body.appendChild(el);

  function makeBtn(label, klass, onClick, testid) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klass;
    b.textContent = label;
    b.dataset.testid = testid;
    b.addEventListener("click", onClick);
    return b;
  }

  return {
    showEmpty() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Sair", "btn-secondary", onExit, "btn-volume-exit"));
      el.hidden = false;
    },
    showResult() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Sair", "btn-secondary", onExit, "btn-volume-exit"));
      el.appendChild(makeBtn("+ Nova", "btn-primary", onNew, "btn-volume-new"));
      el.hidden = false;
    },
    hide() {
      el.innerHTML = "";
      el.hidden = true;
    },
  };
}

// ===========================================================================
// Exame de imagem (DICOM/NRRD) — abas do painel, aba Exame, seletor de layout
// do palco, aviso "Este caso tem exame", seletor de vistas do celular.
// Só DOM: exam.js decide o estado e chama estas funções.
// ===========================================================================

const LAYOUT_ICONS = {
  "3d": '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>',
  "3d+1": '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M13.5 4.5v15"/>',
  "3d+3": '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14 4.5v15M14 9.5h6.5M14 14.5h6.5"/>',
  quad: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15M3.5 12h17"/>',
  single: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/>',
};
export const layoutIcon = (layout) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LAYOUT_ICONS[layout]}</svg>`;

// Nome de cada vista no celular (botão do topo e seletor).
export const VIEW_NAMES = {
  single: "Uma vista",
  "3d+1": "3D + corte",
  "3d+3": "3D + 3 cortes",
  quad: "Quadrantes",
};

// Abas "Estruturas N | Exame" no topo do painel (markup estático no index).
export function mountPanelTabs({ onTab }) {
  const panel = document.getElementById("structures-panel");
  const tabs = panel.querySelector(".panel-tabs");
  const buttons = tabs.querySelectorAll('[role="tab"]');
  buttons.forEach((b) => b.addEventListener("click", () => onTab(b.dataset.tab)));
  return {
    // hasStructures=false: caso só com exame — a aba Estruturas some.
    show({ hasStructures }) {
      panel.dataset.hasExam = "true";
      tabs.hidden = false;
      tabs.querySelector('[data-tab="structures"]').hidden = !hasStructures;
    },
    setTab(tab) {
      panel.dataset.tab = tab;
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    },
    getTab: () => panel.dataset.tab || "structures",
  };
}

const SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>';

// O nome da série é texto livre digitado no tomógrafo (SeriesDescription):
// nunca entra cru no innerHTML.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Seletor de série (só com 2 ou mais). series: [{ label, meta, badge, size, current }].
function examSeriesHtml(series, note) {
  if (!series) return "";
  return `
    <div class="exam-section-title">Série</div>
    <div class="exam-series" role="group" aria-label="Série do exame">
      ${series.map((s, i) => `
        <button type="button" class="exam-series-row" data-series="${i}" aria-pressed="${s.current}"
                data-testid="exam-series-${i}">
          <span class="exam-series-radio" aria-hidden="true"></span>
          <span class="exam-series-main">
            <span class="exam-series-label">${escapeHtml(s.label)}</span>
            <span class="exam-series-meta">${escapeHtml(s.meta)}</span>
          </span>
          ${s.badge ? `<span class="exam-series-badge">${escapeHtml(s.badge)}</span>` : ""}
          ${!s.badge && s.size ? `<span class="exam-series-size">${escapeHtml(s.size)}</span>` : ""}
        </button>`).join("")}
    </div>
    <p class="exam-series-status" role="status" data-testid="exam-series-status" hidden></p>
    ${note ? `<p class="exam-series-note" data-testid="exam-series-note">${escapeHtml(note)}</p>` : ""}`;
}

// Conteúdo da aba Exame. meta: { planes: [{ name, label, count }], subtitle,
//   series (null com uma série só), note }.
// callbacks: onSeries(i), onPlaneIndex(plane, i), onPlaneVisible(plane, on),
//            onAuto(), onBrightness(v), onContrast(v), onOption(opt, on)
export function renderExamPanel(meta, callbacks) {
  const root = document.getElementById("exam-panel");
  root.innerHTML = `
    <div class="exam-head">
      <div class="exam-title-row">
        <span class="exam-title">Exame de imagem</span>
        <span class="exam-anon" title="Nome, datas e identificadores do paciente foram removidos no envio. O nome da série vem do exame.">${SHIELD}Anonimizado</span>
      </div>
      <div class="exam-sub">${meta.subtitle}</div>
    </div>
    ${examSeriesHtml(meta.series, meta.note)}
    <div class="exam-section-title">Planos</div>
    <ul class="exam-planes">
      ${meta.planes.map((p) => `
        <li data-plane="${p.name}" style="--struct-color: var(--w-plane-${p.name})">
          <span class="struct-swatch struct-swatch-static"><span class="struct-swatch-bar"></span></span>
          <div class="structure-row-main">
            <span class="structure-name">${p.label}</span>
            <span class="exam-plane-count" data-testid="plane-count-${p.name}">–</span>
            <button type="button" class="eye-toggle" data-plane="${p.name}" data-visible="false"
                    aria-label="Mostrar plano ${p.label.toLowerCase()} no 3D" data-testid="plane-eye-${p.name}">
              <img src="${EYE_OFF}" alt="">
            </button>
          </div>
          <div class="opacity-row">
            <input type="range" class="exam-range" min="1" max="${p.count}" value="1" step="1"
                   aria-label="Corte ${p.label.toLowerCase()}" data-plane="${p.name}" data-testid="plane-range-${p.name}">
          </div>
        </li>`).join("")}
    </ul>
    <div class="exam-section-title">Imagem
      ${meta.presets ? "" : '<button type="button" class="exam-auto" data-testid="exam-auto">Auto</button>'}
    </div>
    ${meta.presets ? `
    <div class="exam-presets" role="group" aria-label="Janela da TC">
      ${[...meta.presets, { id: "auto", label: "Auto" }].map((p) => `
        <button type="button" class="exam-preset" data-preset="${p.id}" aria-pressed="false"
                data-testid="exam-preset-${p.id}"${p.width ? ` title="Janela ${p.width} · nível ${p.level}"` : ""}>${p.label}</button>`).join("")}
    </div>` : ""}
    <div class="exam-wl">
      <label class="exam-wl-field"><span>Janela</span>
        <input type="number" inputmode="numeric" step="1" min="1" data-control="width" data-testid="exam-width"></label>
      <label class="exam-wl-field"><span>Nível</span>
        <input type="number" inputmode="numeric" step="1" data-control="level" data-testid="exam-level"></label>
    </div>
    <div class="exam-sliders">
      <label class="exam-slider"><span>Brilho</span>
        <input type="range" class="exam-range" min="0" max="100" value="50" data-control="brightness" data-testid="exam-brightness"></label>
      <label class="exam-slider"><span>Contraste</span>
        <input type="range" class="exam-range" min="0" max="100" value="50" data-control="contrast" data-testid="exam-contrast"></label>
    </div>
    <div class="exam-section-title">Nos cortes</div>
    <div class="exam-switches">
      <button type="button" role="switch" class="exam-switch" data-opt="contour" aria-checked="true" data-testid="switch-contour">
        <span class="exam-switch-track" aria-hidden="true"></span>Contorno das estruturas</button>
      <button type="button" role="switch" class="exam-switch" data-opt="cross" aria-checked="true" data-testid="switch-cross">
        <span class="exam-switch-track" aria-hidden="true"></span>Mira ligada entre as vistas</button>
    </div>
    <p class="exam-hint">Role sobre um corte para avançar. Clique num ponto para levar a mira até ele.</p>`;

  root.querySelectorAll(".exam-series-row").forEach((b) => {
    b.addEventListener("click", () => callbacks.onSeries(Number(b.dataset.series)));
  });
  root.querySelectorAll(".eye-toggle[data-plane]").forEach((b) => {
    b.addEventListener("click", () => callbacks.onPlaneVisible(b.dataset.plane, b.dataset.visible !== "true"));
  });
  root.querySelectorAll('input[data-plane]').forEach((r) => {
    r.addEventListener("input", () => callbacks.onPlaneIndex(r.dataset.plane, Number(r.value) - 1));
  });
  root.querySelector(".exam-auto")?.addEventListener("click", callbacks.onAuto);
  root.querySelectorAll(".exam-preset").forEach((b) => {
    b.addEventListener("click", () => callbacks.onPreset(b.dataset.preset));
  });
  // Janela e nível digitados valem no Enter ou ao sair do campo; valor
  // inválido (vazio, janela < 1) volta ao que está na tela.
  const wIn = root.querySelector('[data-control="width"]');
  const lIn = root.querySelector('[data-control="level"]');
  const commit = () => {
    const ok = callbacks.onWindowLevel(Number(wIn.value), Number(lIn.value));
    if (ok === false) { wIn.value = wIn.dataset.shown; lIn.value = lIn.dataset.shown; }
  };
  for (const el of [wIn, lIn]) {
    el.addEventListener("change", commit);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.blur(); });
  }
  root.querySelector('[data-control="brightness"]').addEventListener("input", (e) => callbacks.onBrightness(Number(e.target.value)));
  root.querySelector('[data-control="contrast"]').addEventListener("input", (e) => callbacks.onContrast(Number(e.target.value)));
  root.querySelectorAll(".exam-switch").forEach((s) => {
    s.addEventListener("click", () => {
      const on = s.getAttribute("aria-checked") !== "true";
      s.setAttribute("aria-checked", String(on));
      callbacks.onOption(s.dataset.opt, on);
    });
  });
}

export function setPlaneRow(plane, { index, count, visible }) {
  const root = document.getElementById("exam-panel");
  const li = root?.querySelector(`li[data-plane="${plane}"]`);
  if (!li) return;
  if (index !== undefined) {
    li.querySelector(".exam-plane-count").textContent = `${index + 1}/${count}`;
    li.querySelector("input").value = String(index + 1);
  }
  if (visible !== undefined) {
    const b = li.querySelector(".eye-toggle");
    const label = li.querySelector(".structure-name").textContent.toLowerCase();
    b.dataset.visible = String(visible);
    b.querySelector("img").src = visible ? EYE_ON : EYE_OFF;
    b.setAttribute("aria-label", `${visible ? "Ocultar" : "Mostrar"} plano ${label} no 3D`);
  }
}

// Série sendo baixada: a linha mostra "Carregando…" no lugar do tamanho.
export function setSeriesBusy(i, on) {
  const root = document.getElementById("exam-panel");
  const row = root?.querySelector(`.exam-series-row[data-series="${i}"]`);
  if (!row) return;
  row.setAttribute("aria-busy", String(on));
  const status = root.querySelector(".exam-series-status");
  if (status) {
    status.hidden = !on;
    status.classList.remove("is-error");
    status.textContent = on ? "Carregando a série…" : "";
  }
}

export function setSeriesStatus(text) {
  const status = document.querySelector("#exam-panel .exam-series-status");
  if (!status) return;
  status.hidden = !text;
  status.classList.toggle("is-error", !!text);
  status.textContent = text || "";
}

// Qualquer subconjunto de { brightness, contrast, width, level, preset }.
// Janela e nível mostram a janela em uso (base + brilho/contraste).
export function setExamControls({ brightness, contrast, width, level, preset }) {
  const root = document.getElementById("exam-panel");
  if (!root) return;
  if (brightness !== undefined) root.querySelector('[data-control="brightness"]').value = String(brightness);
  if (contrast !== undefined) root.querySelector('[data-control="contrast"]').value = String(contrast);
  const show = (sel, v) => {
    const el = root.querySelector(sel);
    if (!el || v === undefined) return;
    const r = String(Math.round(v));
    el.dataset.shown = r;
    if (document.activeElement !== el) el.value = r;
  };
  show('[data-control="width"]', width);
  show('[data-control="level"]', level);
  if (preset !== undefined) {
    root.querySelectorAll(".exam-preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === preset)));
  }
}

export function hideExamOption(opt) {
  const s = document.querySelector(`#exam-panel .exam-switch[data-opt="${opt}"]`);
  if (s) s.hidden = true;
}

export function setExamOption(opt, on) {
  const s = document.querySelector(`#exam-panel .exam-switch[data-opt="${opt}"]`);
  if (s) s.setAttribute("aria-checked", String(on));
}

// Aba Exame antes de o exame estar carregado (caso com modelo: o exame só
// baixa quando pedido).
export function renderExamPanelPending({ sizeText, seriesCount = 1, onLoad }) {
  const root = document.getElementById("exam-panel");
  const parts = [];
  if (seriesCount > 1) parts.push(`${seriesCount} séries`);
  if (sizeText) parts.push(seriesCount > 1 ? `${sizeText} para abrir` : `${sizeText} para baixar`);
  root.innerHTML = `
    <div class="exam-head">
      <div class="exam-title-row"><span class="exam-title">Exame de imagem</span>
        <span class="exam-anon">${SHIELD}Anonimizado</span></div>
      <div class="exam-sub" data-testid="exam-pending-sub">${parts.join(" · ")}</div>
    </div>
    <div class="exam-pending"><button type="button" class="btn btn-primary" data-testid="exam-load">Ver cortes</button></div>`;
  root.querySelector('[data-testid="exam-load"]').addEventListener("click", onLoad);
}

// onRetry: quando a falha é de rede, o botão "Tentar de novo" continua ali.
export function renderExamPanelMessage(text, onRetry = null) {
  const root = document.getElementById("exam-panel");
  let pending = root.querySelector(".exam-pending");
  if (!pending) {
    pending = document.createElement("div");
    pending.className = "exam-pending";
    root.appendChild(pending);
  }
  pending.innerHTML = `<p class="exam-hint" role="status">${text}</p>`;
  if (onRetry) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-primary";
    b.dataset.testid = "exam-retry";
    b.textContent = "Tentar de novo";
    b.addEventListener("click", onRetry);
    pending.appendChild(b);
  }
}

// Ícones de layout no topo (desktop). Markup estático no index.
export function mountLayoutSwitcher({ onLayout }) {
  const group = document.querySelector('[data-testid="layout-switcher"]');
  const buttons = group.querySelectorAll("button[data-layout]");
  buttons.forEach((b) => b.addEventListener("click", () => onLayout(b.dataset.layout)));
  return {
    show() { group.hidden = false; },
    setLayout(layout) {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
    },
  };
}

// Aviso discreto no palco: "Este caso tem exame de imagem · Ver cortes".
export function mountExamHint({ onOpen }) {
  const el = document.querySelector('[data-testid="exam-hint"]');
  el.querySelector("button").addEventListener("click", onOpen);
  return {
    show(sizeText) {
      el.querySelector(".exam-hint-size").textContent = sizeText ? `· ${sizeText}` : "";
      el.hidden = false;
    },
    hide() { el.hidden = true; },
    setBusy(busy) {
      const b = el.querySelector("button");
      b.disabled = busy;
      b.textContent = busy ? "Carregando…" : "Ver cortes";
    },
  };
}

// Celular: botão da vista atual no topo + folha com as 4 vistas e a chave do
// mini-3D; tira de abas 3D | Axial | Coronal | Sagital para "Uma vista";
// botão Exame na barra de baixo.
export function mountMobileExamChrome({ onView, onSingle, onMini3d, onExamButton }) {
  const picker = document.querySelector('[data-testid="view-picker"]');
  const scrim = document.querySelector('[data-testid="view-sheet"]');
  const tabs = document.querySelector('[data-testid="view-tabs"]');
  const examBtn = document.querySelector('[data-testid="exam-toggle"]');

  const open = (on) => {
    scrim.hidden = !on;
    picker.setAttribute("aria-expanded", String(on));
    if (on) scrim.querySelector('[aria-checked="true"]')?.focus();
  };
  picker.addEventListener("click", () => open(scrim.hidden));
  scrim.addEventListener("click", (e) => { if (e.target === scrim) open(false); });
  scrim.querySelector(".view-sheet-close").addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !scrim.hidden) open(false); });
  scrim.querySelectorAll('[role="radio"]').forEach((r) => {
    r.addEventListener("click", () => { open(false); onView(r.dataset.layout); });
  });
  const mini = scrim.querySelector('[data-opt="mini3d"]');
  mini.addEventListener("click", () => {
    const on = mini.getAttribute("aria-checked") !== "true";
    mini.setAttribute("aria-checked", String(on));
    onMini3d(on);
  });
  tabs.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener("click", () => onSingle(t.dataset.view)));
  examBtn.addEventListener("click", onExamButton);

  return {
    show() { picker.hidden = false; examBtn.hidden = false; },
    setView(layout, single) {
      picker.querySelector(".view-picker-icon").innerHTML = layoutIcon(layout === "single" ? "single" : layout);
      picker.querySelector(".view-picker-name").textContent = VIEW_NAMES[layout] ?? VIEW_NAMES.single;
      picker.setAttribute("aria-label", `Trocar a vista (agora: ${(VIEW_NAMES[layout] ?? "").toLowerCase()})`);
      scrim.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute("aria-checked", String(r.dataset.layout === layout)));
      tabs.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === single)));
    },
    setExamPressed(on) { examBtn.setAttribute("aria-pressed", String(on)); },
    isOpen: () => !scrim.hidden,
  };
}
