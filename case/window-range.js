// Uma janela, dois limites. O intervalo também pode ser arrastado inteiro.
// Mantém a escala estável durante o gesto e permite ajuste pelo teclado.
export function mountWindowRange(root, range, onChange) {
  const handles = [...root.querySelectorAll('[role="slider"]')];
  let min = Math.floor(range.lo), max = Math.ceil(range.hi);
  let lo = range.lo, hi = range.hi;
  let drag = null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

  function setWindow(window, range) {
    if (range) {
      min = Math.floor(range.lo);
      max = Math.ceil(range.hi);
    }
    lo = window.lo;
    hi = window.hi;
    min = Math.min(min, Math.floor(lo));
    max = Math.max(max, Math.ceil(hi), min + 1);
    root.style.setProperty("--window-low", `${(lo - min) / (max - min) * 100}%`);
    root.style.setProperty("--window-high", `${(hi - min) / (max - min) * 100}%`);
    for (const handle of handles) {
      const lower = handle.dataset.bound === "lo";
      handle.setAttribute("aria-valuemin", String(lower ? min : lo + 1));
      handle.setAttribute("aria-valuemax", String(lower ? hi - 1 : max));
      handle.setAttribute("aria-valuenow", String(lower ? lo : hi));
      handle.setAttribute("aria-valuetext", number.format(lower ? lo : hi));
    }
  }

  function change(nextLo, nextHi) {
    onChange(nextHi - nextLo, (nextLo + nextHi) / 2);
  }

  function moveBound(bound, value) {
    if (bound === "lo") change(clamp(value, min, hi - 1), hi);
    else change(lo, clamp(value, lo + 1, max));
  }

  for (const handle of handles) {
    handle.addEventListener("keydown", (event) => {
      const lower = handle.dataset.bound === "lo";
      const value = lower ? lo : hi;
      const step = event.shiftKey ? 10 : 1;
      const page = Math.max(1, Math.round((max - min) / 10));
      const values = {
        ArrowLeft: value - step, ArrowDown: value - step,
        ArrowRight: value + step, ArrowUp: value + step,
        PageDown: value - page, PageUp: value + page,
        Home: lower ? min : lo + 1, End: lower ? hi - 1 : max,
      };
      if (!(event.key in values)) return;
      event.preventDefault();
      moveBound(handle.dataset.bound, values[event.key]);
    });
  }

  root.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    const rect = root.getBoundingClientRect();
    const value = min + (event.clientX - rect.left) / rect.width * (max - min);
    const handle = event.target.closest('[role="slider"]');
    const band = event.target.closest(".exam-window-band");
    let bound = handle?.dataset.bound;
    // Com os cursores próximos, cada metade continua alcançável pelo toque.
    if (handle && (hi - lo) / (max - min) * rect.width < handle.getBoundingClientRect().width) {
      bound = value <= (lo + hi) / 2 ? "lo" : "hi";
    }
    if (!bound && !band) bound = Math.abs(value - lo) <= Math.abs(value - hi) ? "lo" : "hi";
    drag = { id: event.pointerId, x: event.clientX, lo, hi, bound, scale: (max - min) / rect.width };
    if (bound) {
      handles.find((h) => h.dataset.bound === bound).focus({ preventScroll: true });
      if (!handle) {
        moveBound(bound, Math.round(value));
        drag.lo = lo;
        drag.hi = hi;
      }
    }
    root.setPointerCapture(event.pointerId);
    root.dataset.dragging = bound || "band";
    event.preventDefault();
  });

  root.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = Math.round((event.clientX - drag.x) * drag.scale);
    if (drag.bound) moveBound(drag.bound, drag[drag.bound] + delta);
    else {
      const shift = clamp(delta, min - drag.lo, max - drag.hi);
      change(drag.lo + shift, drag.hi + shift);
    }
  });

  const end = (event) => {
    if (event.pointerId !== drag?.id) return;
    drag = null;
    delete root.dataset.dragging;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  root.addEventListener("lostpointercapture", end);
  return { setWindow };
}
