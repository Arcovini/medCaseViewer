// case-next/dom.js
// UI helpers: structures panel, loading and error overlays.
// Knows nothing about Three.js beyond the structure name (string).

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

export function renderStructures(names, onToggle) {
  list.innerHTML = "";
  for (const name of names) {
    const li = document.createElement("li");

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

    li.appendChild(labelEl);
    li.appendChild(btn);
    list.appendChild(li);
  }
}
