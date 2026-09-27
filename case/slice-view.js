// case/slice-view.js
// Uma vista de corte: cabeçalho (plano, "Corte N / M"), a imagem, letras de
// orientação, barra de escala, mira e contorno por cima, e o rodapé com
// anterior / régua / próximo. Só DOM — não sabe de Three.js nem de onde vêm os
// pixels: exam.js entrega um canvas com a fatia em resolução nativa e o
// "layout" do plano (exam-geom.planeLayout), e esta vista só o encaixa na tela.

import { PLANES, PLANE_LABEL, fitSlice, voxelToScreen, screenToVoxel, scaleBar } from "./exam-geom.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const ICON_PROMOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

// section: o <section class="slice-view" data-plane="..."> do index.html.
// callbacks: onIndex(plane, index), onPick(plane, h, v, done),
//            onPromote(plane), onSwitchPlane(fromPlane, toPlane)
export function createSliceView(section, plane, callbacks) {
  const { onIndex, onPick, onPromote, onSwitchPlane } = callbacks;
  const label = PLANE_LABEL[plane];
  section.setAttribute("aria-label", `Corte ${label.toLowerCase()}`);
  section.dataset.testid = `slice-${plane}`;
  section.innerHTML = `
    <div class="sv-head">
      <span class="sv-chip"><span class="sv-dot" aria-hidden="true"></span><span class="sv-name">${label}</span></span>
      <div class="sv-switch" role="tablist" aria-label="Plano do corte">
        ${PLANES.map((p) => `
          <button type="button" role="tab" class="sv-switch-btn" data-plane="${p}" aria-selected="${p === plane}">
            <span class="sv-dot" aria-hidden="true"></span>${PLANE_LABEL[p]}
          </button>`).join("")}
      </div>
      <span class="sv-count" data-testid="slice-count-${plane}">Corte <b>–</b> / –</span>
      <button type="button" class="sv-promote" aria-label="Ver o corte ${label.toLowerCase()} ao lado do 3D" title="Ver ao lado do 3D">${ICON_PROMOTE}</button>
    </div>
    <div class="sv-body">
      <canvas class="sv-canvas"></canvas>
      <svg class="sv-overlay" aria-hidden="true"></svg>
      <span class="sv-letter" data-side="top"></span>
      <span class="sv-letter" data-side="left"></span>
      <span class="sv-letter" data-side="right"></span>
      <div class="sv-scale" aria-hidden="true"><span class="sv-scale-label"></span><span class="sv-scale-bar"></span></div>
    </div>
    <div class="sv-foot">
      <button type="button" class="sv-step" data-step="-1" aria-label="Corte anterior">${ICON_PREV}</button>
      <input type="range" class="sv-range" min="1" max="1" value="1" step="1" aria-label="Corte ${label.toLowerCase()}" data-testid="slice-slider-${plane}">
      <button type="button" class="sv-step" data-step="1" aria-label="Próximo corte">${ICON_NEXT}</button>
    </div>`;

  const body = section.querySelector(".sv-body");
  const canvas = section.querySelector(".sv-canvas");
  const ctx = canvas.getContext("2d");
  const svg = section.querySelector(".sv-overlay");
  const range = section.querySelector(".sv-range");
  const countEl = section.querySelector(".sv-count");
  const scaleEl = section.querySelector(".sv-scale");
  const scaleLabel = section.querySelector(".sv-scale-label");
  const scaleBarEl = section.querySelector(".sv-scale-bar");
  const letters = {
    top: section.querySelector('.sv-letter[data-side="top"]'),
    left: section.querySelector('.sv-letter[data-side="left"]'),
    right: section.querySelector('.sv-letter[data-side="right"]'),
  };

  let layout = null;
  let source = null;
  let index = 0;
  let cross = null;       // { h, v, hColor, vColor } em índices de voxel
  let crossVisible = true;
  let segments = [];      // [{ color, points: Float32Array h0 v0 h1 v1 … }] — contorno
  let rect = null;        // onde a imagem caiu na vista (CSS px)
  let W = 0, H = 0;

  // ---- Entrada --------------------------------------------------------------

  // O índice local anda na hora (otimista): o redesenho vem no próximo
  // quadro, e vários passos no mesmo quadro (roda, trackpad) não podem
  // partir todos do mesmo valor.
  const step = (d) => {
    if (!layout) return;
    const next = Math.max(0, Math.min(layout.count - 1, index + d));
    if (next === index) return;
    index = next;
    onIndex(plane, next);
  };
  section.querySelectorAll(".sv-step").forEach((b) => {
    b.addEventListener("click", () => step(Number(b.dataset.step)));
  });
  range.addEventListener("input", () => onIndex(plane, Number(range.value) - 1));

  // Roda do mouse: um corte por "clique" da roda; no trackpad (deltas
  // pequenos e contínuos) acumula para não voar pela série.
  let wheelAcc = 0;
  body.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) {
      step(Math.sign(e.deltaY));
      return;
    }
    wheelAcc += e.deltaY;
    while (Math.abs(wheelAcc) >= 24) {
      step(Math.sign(wheelAcc));
      wheelAcc -= 24 * Math.sign(wheelAcc);
    }
  }, { passive: false });

  // Clicar/arrastar na imagem leva a mira até o ponto (define o corte dos
  // outros dois planos).
  let dragging = false;
  const pick = (e, done) => {
    if (!layout || !rect) return;
    const r = body.getBoundingClientRect();
    const [h, v] = screenToVoxel(layout, rect, e.clientX - r.left, e.clientY - r.top);
    if (h < -0.5 || v < -0.5 || h > layout.nh - 0.5 || v > layout.nv - 0.5) return;
    onPick(plane, h, v, done);
  };
  body.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    body.setPointerCapture?.(e.pointerId);
    pick(e, false);
  });
  body.addEventListener("pointermove", (e) => { if (dragging) pick(e, false); });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    pick(e, true);
  };
  body.addEventListener("pointerup", end);
  body.addEventListener("pointercancel", () => { dragging = false; });

  section.querySelector(".sv-promote").addEventListener("click", () => onPromote(plane));
  section.querySelectorAll(".sv-switch-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.plane !== plane) onSwitchPlane(plane, b.dataset.plane);
    });
  });

  // ---- Desenho --------------------------------------------------------------

  const ro = new ResizeObserver(() => redraw());
  ro.observe(body);

  function redraw() {
    W = body.clientWidth;
    H = body.clientHeight;
    if (!W || !H || !layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    rect = fitSlice(layout, W, H);
    if (source) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.save();
      ctx.translate(rect.x + (layout.flipH ? rect.w : 0), rect.y + (layout.flipV ? rect.h : 0));
      ctx.scale(layout.flipH ? -1 : 1, layout.flipV ? -1 : 1);
      ctx.drawImage(source, 0, 0, layout.nh, layout.nv, 0, 0, rect.w, rect.h);
      ctx.restore();
    }
    drawOverlay();
    const bar = scaleBar(rect.pxPerMm, W / 4);
    scaleLabel.textContent = bar.label;
    scaleBarEl.style.width = `${bar.px}px`;
    scaleEl.hidden = false;
  }

  function drawOverlay() {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    if (!rect) return;
    // Contorno: pares de pontos (h, v) — cada 4 números um segmento.
    for (const seg of segments) {
      const pts = seg.points;
      let d = "";
      for (let t = 0; t < pts.length; t += 4) {
        const [x0, y0] = voxelToScreen(layout, rect, pts[t], pts[t + 1]);
        const [x1, y1] = voxelToScreen(layout, rect, pts[t + 2], pts[t + 3]);
        d += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
      }
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "sv-contour");
      path.setAttribute("stroke", seg.color);
      svg.appendChild(path);
    }
    if (cross && crossVisible) {
      const [x] = voxelToScreen(layout, rect, cross.h, 0);
      const [, y] = voxelToScreen(layout, rect, 0, cross.v);
      svg.appendChild(line(x, rect.y, x, rect.y + rect.h, cross.hColor));
      svg.appendChild(line(rect.x, y, rect.x + rect.w, y, cross.vColor));
    }
  }

  function line(x1, y1, x2, y2, color) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke", color);
    l.setAttribute("class", "sv-cross");
    return l;
  }

  // ---- API ------------------------------------------------------------------

  return {
    plane,
    element: section,
    setLayout(l) {
      layout = l;
      range.max = String(l.count);
      letters.top.textContent = l.letters.top;
      letters.left.textContent = l.letters.left;
      letters.right.textContent = l.letters.right;
      redraw();
    },
    setSource(c) { source = c; redraw(); },
    setIndex(i) {
      index = i;
      range.value = String(i + 1);
      countEl.innerHTML = `Corte <b>${i + 1}</b> / ${layout ? layout.count : "–"}`;
    },
    setCrosshair(c) { cross = c; drawOverlay(); },
    setCrosshairVisible(v) { crossVisible = v; drawOverlay(); },
    setSegments(s) { segments = s; drawOverlay(); },
    redraw,
    getRect: () => rect,
    getIndex: () => index,
  };
}
