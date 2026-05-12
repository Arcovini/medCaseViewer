// case-next/dom.js
// UI helpers: structures panel, loading and error overlays.
// Knows nothing about Three.js beyond the structure name (string) and color (hex string).

const list = document.getElementById("structures-list");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

const EYE_ON = "./eye_icon.svg";
const EYE_OFF = "./eye_off_icon.svg";

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
  const { onToggle, onOpacityChange } = callbacks;
  list.innerHTML = "";

  for (const { name, color } of structures) {
    const li = document.createElement("li");
    if (color) li.style.setProperty("--struct-color", color);

    // Linha 1: nome + olho
    const rowMain = document.createElement("div");
    rowMain.className = "structure-row-main";

    const labelEl = document.createElement("span");
    labelEl.className = "structure-name";
    labelEl.textContent = name;

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
    slider.setAttribute("aria-label", `Opacidade de ${name}`);

    slider.addEventListener("input", () => {
      onOpacityChange(name, parseFloat(slider.value));
    });

    rowOpacity.appendChild(slider);

    li.appendChild(rowMain);
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
  const clamped = Math.max(15, Math.min(90, newHeightVh));

  _panelEl.style.setProperty("--panel-height", `${clamped}vh`);

  e.preventDefault();
}

function _onDragEnd() {
  if (!_isDragging) return;
  _isDragging = false;

  _panelEl.classList.remove("is-dragging");

  const currentHeightVh = (_panelEl.getBoundingClientRect().height / window.innerHeight) * 100;
  const midpoint = (SNAP_COLLAPSED_VH + SNAP_EXPANDED_VH) / 2;
  const snapTo = currentHeightVh > midpoint ? SNAP_EXPANDED_VH : SNAP_COLLAPSED_VH;
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

const _FAB_ICON_RULER = `<path d="M3 12 L7 8 L21 8 L21 16 L7 16 Z"/><path d="M9 8 L9 12 M13 8 L13 12 M17 8 L17 12"/>`;
const _FAB_ICON_X = `<path d="M6 6 L18 18 M18 6 L6 18"/>`;

export function mountMeasurementFAB({ onStart, onCancel }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "measure-fab";
  btn.dataset.state = "idle";
  btn.dataset.testid = "measure-fab";
  btn.hidden = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_FAB_ICON_RULER}</svg>
    <span class="label">Medir</span>
  `;
  btn.addEventListener("click", () => {
    if (btn.dataset.state === "idle") onStart();
    else onCancel();
  });
  document.body.appendChild(btn);

  return {
    setState(state) {
      btn.dataset.state = state;
      const label = btn.querySelector(".label");
      const svg = btn.querySelector("svg");
      if (state === "cancel") {
        label.textContent = "Cancelar";
        svg.innerHTML = _FAB_ICON_X;
      } else {
        label.textContent = "Medir";
        svg.innerHTML = _FAB_ICON_RULER;
      }
    },
    setVisible(visible) { btn.hidden = !visible; },
  };
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
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ar-button";
  btn.dataset.visible = "false";
  btn.dataset.loading = "false";
  btn.dataset.testid = "ar-button";
  btn.setAttribute("aria-label", "Ver em AR");
  btn.textContent = "AR";
  btn.addEventListener("click", () => {
    if (btn.dataset.loading === "true") return;   // ignora clique duplo enquanto gera USDZ
    onClick();
  });
  document.body.appendChild(btn);

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

export function mountLoupe() {
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

  return {
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
        labelEl.textContent = text;
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
