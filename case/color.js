// case/color.js
// Paleta anatômica + popover de troca de cor das estruturas.
// Não conhece Three.js: fala em nome da estrutura (string) e hex sRGB
// ("#RRGGBB"). main.js liga o callback `onPick` ao world.setMeshColor.

import { displayLabel } from "./dom.js";

// Espelha a paleta do backend (mesh-processor/processor.py: COLORS_BY_KEYWORD,
// METAL_COLOR e FALLBACK_COLORS). Manter os mesmos hexes garante que uma
// estrutura repintada à mão no viewer fique idêntica a uma que já tivesse
// chegado com aquela cor do upload — e mantém a leitura clínica consistente
// entre casos. 12 presets = 2 linhas de 6 no grid.
export const COLOR_PRESETS = [
  { hex: "#BD0006", label: "Artéria" },
  { hex: "#DC267F", label: "Magenta" },
  { hex: "#DC8576", label: "Pele" },
  { hex: "#BA5531", label: "Rim" },
  { hex: "#966830", label: "Córtex" },
  { hex: "#EAE3D2", label: "Osso" },
  { hex: "#08E700", label: "Tumor" },
  { hex: "#477EFF", label: "Veia" },
  { hex: "#648FFF", label: "Azul" },
  { hex: "#785EF0", label: "Roxo" },
  { hex: "#FFB000", label: "Ouro" },
  { hex: "#C0C4C8", label: "Metal" },
];

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

// Normaliza pra "#rrggbb" minúsculo — `input[type=color]` sempre devolve
// minúsculo, mas os presets e o hex vindo do world.js vêm em maiúsculo.
// Sem isso a marcação de preset selecionado nunca casaria.
function norm(hex) {
  return typeof hex === "string" ? hex.trim().toLowerCase() : null;
}

export function mountColorPicker({ onPick }) {
  const el = document.createElement("div");
  el.className = "color-pop";
  el.dataset.open = "false";
  el.dataset.testid = "color-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Cor da estrutura");

  el.innerHTML = `
    <div class="color-pop-head">
      <span class="color-pop-title">Cor</span>
      <span class="color-pop-name" data-testid="color-pop-name"></span>
    </div>
    <div class="color-pop-grid" data-testid="color-pop-grid">
      ${COLOR_PRESETS.map(
        (p) => `<button type="button" class="color-swatch-opt" data-hex="${p.hex}"
                  title="${p.label}" aria-label="${p.label}"
                  style="--opt-color:${p.hex}"></button>`,
      ).join("")}
    </div>
    <div class="color-pop-foot">
      <label class="color-pop-custom">
        <input type="color" data-testid="color-pop-custom" aria-label="Cor personalizada" />
        <span>Personalizada</span>
      </label>
      <button type="button" class="color-pop-reset" data-testid="color-pop-reset">Restaurar</button>
    </div>
  `;
  document.body.appendChild(el);

  const nameEl = el.querySelector(".color-pop-name");
  const gridEl = el.querySelector(".color-pop-grid");
  const customEl = el.querySelector(".color-pop-custom input");
  const resetEl = el.querySelector(".color-pop-reset");

  let _name = null;
  let _originalHex = null;
  let _currentHex = null;
  let _anchorEl = null;

  function markSelection() {
    const cur = norm(_currentHex);
    for (const opt of gridEl.querySelectorAll(".color-swatch-opt")) {
      opt.dataset.selected = String(norm(opt.dataset.hex) === cur);
    }
    // Restaurar só faz sentido quando há o que restaurar.
    const canReset = !!_originalHex && cur !== norm(_originalHex);
    resetEl.disabled = !canReset;
  }

  function apply(hex) {
    _currentHex = hex;
    if (customEl.value !== hex) customEl.value = hex;
    markSelection();
    onPick(_name, hex);
  }

  function position() {
    if (!_anchorEl) return;
    const r = _anchorEl.getBoundingClientRect();
    const w = el.offsetWidth || 236;
    const h = el.offsetHeight || 180;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    // Abre pra direita do swatch (que fica na borda esquerda da linha),
    // clampando pra não vazar da viewport.
    let left = r.left;
    if (left + w > vw - VIEWPORT_MARGIN) left = vw - w - VIEWPORT_MARGIN;
    left = Math.max(VIEWPORT_MARGIN, left);

    // Abaixo por padrão; flipa pra cima se não couber embaixo mas couber em cima.
    let top = r.bottom + ANCHOR_GAP;
    if (top + h > vh - VIEWPORT_MARGIN && r.top - ANCHOR_GAP - h > VIEWPORT_MARGIN) {
      top = r.top - ANCHOR_GAP - h;
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - h - VIEWPORT_MARGIN));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function openFor({ anchorEl, name, currentHex, originalHex }) {
    _anchorEl = anchorEl;
    _name = name;
    _originalHex = norm(originalHex);
    _currentHex = norm(currentHex) || _originalHex || "#ffffff";

    nameEl.textContent = displayLabel(name);
    customEl.value = _currentHex;
    markSelection();

    el.dataset.open = "true";
    if (anchorEl) anchorEl.setAttribute("aria-expanded", "true");
    position();
  }

  function close() {
    if (el.dataset.open !== "true") return;
    el.dataset.open = "false";
    if (_anchorEl) _anchorEl.setAttribute("aria-expanded", "false");
    _anchorEl = null;
    _name = null;
  }

  function isOpen() {
    return el.dataset.open === "true";
  }

  gridEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".color-swatch-opt");
    if (!opt) return;
    apply(norm(opt.dataset.hex));
  });

  // `input` (não `change`) pra que arrastar no seletor nativo do SO repinte
  // a malha ao vivo, sem esperar o usuário fechar o diálogo.
  customEl.addEventListener("input", () => apply(norm(customEl.value)));

  resetEl.addEventListener("click", () => {
    if (_originalHex) apply(_originalHex);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!isOpen()) return;
    if (el.contains(e.target)) return;
    if (_anchorEl && _anchorEl.contains(e.target)) return;
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  // O popover é `position: fixed` e o painel de estruturas rola (desktop:
  // `.panel`; mobile: `.panel ul`). Sem isto ele "descolaria" do swatch ao
  // rolar. Capture-phase pega o scroll de qualquer container.
  document.addEventListener("scroll", () => { if (isOpen()) close(); }, true);
  window.addEventListener("resize", () => { if (isOpen()) position(); });

  return { openFor, close, isOpen, getElement: () => el };
}
