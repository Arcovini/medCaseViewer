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
