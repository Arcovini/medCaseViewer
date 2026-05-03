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
