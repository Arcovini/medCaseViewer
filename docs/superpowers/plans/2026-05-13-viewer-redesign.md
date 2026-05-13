# Viewer redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/case-next/` from the current dark/cyan shell to the editorial clinical-light register (paper canvas, hairlines, single coral accent), per the approved `ui_kits/viewer/index_v3.html` (desktop) and `ui_kits/viewer/mobile_v2.html` (mobile) mockups. Add new chrome (top bar, foot strip, zoom chip, legend, optional right meta panel) without touching JS behavior — Playwright suite stays green.

**Architecture:** All existing JS modules (`world.js`, `dom.js`, `loader.js`, `main.js`, `measurement.js`, `ar.js`) keep their public APIs and `data-testid` contracts. Two cosmetic edits to `world.js` (rename `COLOR_CYAN` → `COLOR_ACCENT` with value `#C8412C`; flip `scene.background` to `#EDEFF2`). Additions to `main.js` (post-bootstrap UI population + top-bar handlers + zoom listener). Full markup replacement in `case-next/index.html` to wrap the canvas in a `.viewer` grid with new chrome. Full restyle in `case-next/style.css` to consume `colors_and_type.css` tokens.

**Tech Stack:** Three.js (existing), Plain CSS + `colors_and_type.css` tokens, Playwright (existing). No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-13-viewer-redesign-design.md`. Read it for the design rationale.

**Reference mockups (extracted at `/tmp/biodesignlab-handoff/biodesignlab-design-system/project/`):**
- `ui_kits/viewer/index_v3.html` — desktop, light, 3-col grid.
- `ui_kits/viewer/mobile_v2.html` — mobile, supports light/dark toggle (we ship light).

**Constants used throughout:**

- `ACCENT_HEX_RGB` = `0xC8412C` (Three.js Color constructor hex; coral, matches CSS `var(--accent)`).
- `CANVAS_BG_RGB` = `0xEDEFF2` (Three.js Color hex; matches CSS `var(--surface-canvas)`).
- `MOBILE_BREAKPOINT` = 768px (existing; defined in `dom.js`).
- `DESKTOP_BREAKPOINT` = 900px (existing media query in `style.css`).
- `RIGHT_PANEL_BREAKPOINT` = 1100px (new; controls when `.vw-right` shows).

**File structure:**

| Path | Action | Purpose |
|---|---|---|
| `case-next/index.html` | Rewrite | Wrap canvas in `.viewer` grid; add `.vw-top`, `.vw-left` slot (wrapping `<aside id="structures-panel">`), `.vw-stage`, `.vw-right`, `.vw-foot`, `.vw-zoom`, `.vw-legend`. Link `colors_and_type.css`. Drop Google Fonts Nunito/Open Sans `<link>` (tokens carry their own families). |
| `case-next/style.css` | Rewrite | Full restyle for light theme + new chrome. Same selectors preserved (`.panel`, `.eye-toggle`, `.measure-fab`, etc.) but reskinned. New rules for `.viewer`, `.vw-*`. |
| `case-next/world.js` | Patch | Rename `COLOR_CYAN` → `COLOR_ACCENT`, value `0xC8412C`. Flip `scene.background` to `0xEDEFF2`. Add `zoomBy(factor)` / `getZoomPercentage()` exports. |
| `case-next/main.js` | Patch | Add post-bootstrap UI population (foot stats, legend, case-head, top-bar handlers, zoom listener). |
| `case-next/dom.js`, `loader.js`, `measurement.js`, `ar.js` | **Do NOT touch** | Behavior identical. |
| `case-next/eye_icon.svg`, `eye_off_icon.svg` | **Do NOT touch** | Stroke is `currentColor`; we drop the CSS `filter: invert(1)` so the icons render ink-on-paper. |
| `tests/case-next/case-next-redesign.spec.js` | Create | 6 new Playwright scenarios covering the new chrome. |
| `tests/case-next/case-next.spec.js`, `case-next-ar.spec.js` | **Do NOT touch** | Selectors and `data-testid`s preserved; existing assertions hold. |
| `colors_and_type.css`, `site.css`, `index.html`, `style.css` (root) | **Do NOT touch** | Out of scope. |
| `playwright.config.js`, `package.json` | **Do NOT touch** | No new deps. |

---

## Task 1 — `world.js`: cosmetic flip + zoom helpers

**Files:**
- Modify: `case-next/world.js`

The changes here are minimal and orthogonal to existing behavior: renaming a constant, flipping a clear color, and adding three small helpers for zoom control.

- [ ] **Step 1: Rename `COLOR_CYAN` → `COLOR_ACCENT` and change value**

Open `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/world.js`.

Replace this line:
```js
const COLOR_CYAN = 0x00d4ff;
```
with:
```js
const COLOR_ACCENT = 0xC8412C;
```

Then replace every reference to `COLOR_CYAN` with `COLOR_ACCENT` (use `Edit` with `replace_all: true` on `COLOR_CYAN`). There are 5 in-body uses:
- Line ~98: `outlinePass.visibleEdgeColor.setHex(COLOR_CYAN)`
- Line ~99: `outlinePass.hiddenEdgeColor.setHex(COLOR_CYAN)`
- Line ~293: `const mat = new THREE.MeshBasicMaterial({ color: COLOR_CYAN, depthTest: false });`
- Line ~346: `color: COLOR_CYAN,` (inside LineDashedMaterial for candidate ring)
- Line ~404: `color: COLOR_CYAN,` (inside LineMaterial for the measurement line)

- [ ] **Step 2: Flip `scene.background`**

Find the line `scene.background = new THREE.Color(0x272425);` (around line 52) and replace with:
```js
scene.background = new THREE.Color(0xEDEFF2);
```

- [ ] **Step 3: Add zoom helpers and capture initial camera distance**

In `frameToScene()` (around line 185), at the END of the function (just before the closing brace), append a line that captures the distance for zoom calculations.

Find `export function frameToScene() {`. Read the existing body (~15 lines). At the very end of its body, just before the closing `}`, add:

```js
  _initialCameraDistance = camera.position.distanceTo(controls.target);
```

Then near the top of the file, just after the `let mountedRoot = null;` declaration (around line 24), add a new top-level variable:

```js
let _initialCameraDistance = null;
```

- [ ] **Step 4: Add `zoomBy` and `getZoomPercentage` exports**

At the end of `world.js` (after the last existing `export function`), append:

```js

// --- Zoom helpers (used by the floating zoom chip in case-next/index.html) ---
// zoomBy(factor): dolly the camera by a multiplicative factor toward (factor>1)
// or away from (factor<1) the orbit target. factor=1.2 dollyIn equivalent.

export function zoomBy(factor) {
  if (!controls || !camera) return;
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  offset.multiplyScalar(1 / factor);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

// getZoomPercentage(): integer percent relative to the initial framed distance.
// 100% = at the frame-to-scene distance; >100% = zoomed in; <100% = zoomed out.

export function getZoomPercentage() {
  if (!controls || !camera || _initialCameraDistance === null) return 100;
  const current = camera.position.distanceTo(controls.target);
  if (current === 0) return 100;
  return Math.round((_initialCameraDistance / current) * 100);
}
```

- [ ] **Step 5: Run existing case-next tests to confirm no regression**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test tests/case-next --reporter=list 2>&1 | tail -30
```

Expected: All existing case-next tests still pass. (They don't assert color values — they assert behavior.) If a test fails, the rename or scene-bg flip introduced a syntax/regression issue; debug before continuing.

---

## Task 2 — `case-next/index.html`: full markup rewrite

**Files:**
- Modify: `case-next/index.html` (full rewrite)

- [ ] **Step 1: Write the new HTML**

Replace the entire content of `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/index.html` with:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Medcase — visualizador 3D</title>

    <link rel="stylesheet" href="../colors_and_type.css" />
    <link rel="stylesheet" href="./style.css" />

    <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.164.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.164.0/examples/jsm/"
      }
    }
    </script>
  </head>
  <body>

    <div class="viewer">

      <header class="vw-top">
        <div class="vw-top-left">
          <span class="vw-brand" aria-label="Medcase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>
            Medcase<em>.</em><span class="vw-sep">/</span><span class="vw-case-id">caso <span data-bind="uid-short">—</span></span>
          </span>
        </div>
        <div class="vw-crumb" data-bind="crumb"></div>
        <div class="vw-top-right">
          <button class="vw-icon-btn" data-action="reset-camera" title="Resetar câmera" aria-label="Resetar câmera">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
          </button>
          <button class="vw-icon-btn" data-action="fullscreen" title="Tela cheia" aria-label="Tela cheia">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
          </button>
          <button class="vw-share" data-action="share" title="Copiar link" aria-label="Compartilhar">Compartilhar</button>
        </div>
      </header>

      <aside class="vw-left">
        <aside id="structures-panel" class="panel">
          <div class="panel-handle"></div>
          <div class="panel-title">Estruturas <span class="panel-count" data-bind="structure-count">—</span></div>
          <ul id="structures-list"></ul>
        </aside>
      </aside>

      <main class="vw-stage">
        <canvas id="canvas"></canvas>

        <div class="vw-zoom" aria-label="Zoom">
          <button class="vw-zoom-btn" data-action="zoom-out" aria-label="Diminuir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
          </button>
          <span class="vw-zoom-value" data-bind="zoom-pct">100%</span>
          <button class="vw-zoom-btn" data-action="zoom-in" aria-label="Aumentar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>

        <div class="vw-legend" aria-label="Legenda de estruturas">
          <div class="vw-legend-ttl">Estruturas</div>
          <div class="vw-legend-rows" data-bind="legend-rows"></div>
        </div>

        <div id="loading" class="overlay" hidden>Carregando...</div>
        <div id="error" class="overlay error" hidden></div>
      </main>

      <aside class="vw-right" data-show="false">
        <div class="vw-case-head">
          <div class="vw-case-eyebrow">Caso</div>
          <h2 class="vw-case-title" data-bind="case-title">—</h2>
          <div class="vw-case-pid" data-bind="case-pid">—</div>
        </div>
        <dl class="vw-kv">
          <dt>Estruturas</dt><dd data-bind="kv-count">—</dd>
        </dl>
        <div class="vw-notes" hidden>
          <!-- placeholder pra notas — Sprint 4+ -->
        </div>
      </aside>

      <footer class="vw-foot">
        <div class="vw-foot-stat"><span class="vw-dot-ok"></span>Segmentação <b>validada</b></div>
        <div class="vw-foot-stat">Render · <b>WebGL2</b> · <span data-bind="foot-count">—</span> camadas · <span data-bind="foot-size">—</span></div>
        <div class="vw-foot-stat">v1 · Medcase / Dasa</div>
      </footer>

    </div>

    <div id="ar-root" class="ar-root" aria-hidden="true"></div>

    <script type="module" src="./main.js"></script>
  </body>
</html>
```

Notes on what's preserved (these are the contract with `world.js`, `dom.js`, `ar.js`, and the test suite):

- `<canvas id="canvas">` — `world.init(canvas)`.
- `<aside id="structures-panel" class="panel">` — `dom.initBottomSheet()` + the test selector `.panel`.
- `<div class="panel-handle">` — mobile drag handle.
- `<div class="panel-title">` — tested at `tests/case-next/case-next.spec.js:46:1` (renderiza nomes).
- `<ul id="structures-list">` — `dom.renderStructures` populates this.
- `<div id="loading">`, `<div id="error">` — `dom.showLoading()` / `dom.showError()`.
- `<div id="ar-root">` — `ar.js` mounts `<model-viewer>` here off-screen.

What's new:
- The whole `.viewer` grid wrapper plus its 5 children.
- The `.vw-zoom` chip, `.vw-legend` panel, and the right meta panel are *inside* the stage / outside the canvas — they overlay the rendering surface.
- All bound texts have `data-bind="<name>"` attributes; `main.js` queries those.

- [ ] **Step 2: Verify the structures-panel + canvas + ar-root selectors still exist**

```bash
grep -nE 'id="(structures-panel|canvas|structures-list|loading|error|ar-root)"|class="panel "|class="panel"|panel-handle|panel-title' /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/index.html
```

Expected: at least 7 matches (one per id/selector listed above).

- [ ] **Step 3: Verify Nunito/Open Sans link is gone**

```bash
grep -c "Nunito\|Open+Sans" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/index.html || echo "0 hits"
```

Expected: `0 hits` (the Google Fonts link for those families is removed; fonts now come from `colors_and_type.css`).

---

## Task 3 — `case-next/style.css`: full restyle

**Files:**
- Modify: `case-next/style.css` (full rewrite)

This is a large file. The new version preserves every selector that any test or behavior references (`.panel`, `.panel-handle`, `.panel-title`, `.structure-row-main`, `.opacity-row`, `.opacity-slider`, `.eye-toggle`, `.measurement-pill`, `.measurement-endpoint-label`, `.measure-fab`, `.measure-fab[data-state="cancel"]`, `.measure-hint`, `.measure-toolbar`, `.measure-toolbar .btn-primary`, `.measure-toolbar .btn-secondary`, `.measure-loupe*`, `.ar-button`, `.ar-button[data-visible="true"]`, `.ar-button[data-loading="true"]`, `.ar-modal*`, `.ar-root`) and adds the new `.viewer` grid + `.vw-*` classes.

- [ ] **Step 1: Replace the file content**

Overwrite `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/style.css` with:

```css
/* ============================================================
   case-next — viewer styles (Medcase redesign 2026-05-13)
   Light theme. Tokens come from /colors_and_type.css (loaded
   before this file in index.html). Preserves all selectors
   the Playwright suite and the JS modules reference.
   ============================================================ */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  background: var(--base);
  color: var(--fg-1);
  font-family: var(--font-text);
  overflow: hidden;
}

#canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* ============================================================
   VIEWER SHELL — 3-col grid in desktop, single-col on tablet/mobile
   ============================================================ */
.viewer {
  display: grid;
  grid-template-rows: 52px 1fr 30px;
  grid-template-columns: 280px 1fr 320px;
  grid-template-areas:
    "top top top"
    "left stage right"
    "foot foot foot";
  height: 100vh;
  background: var(--base);
}
@media (max-width: 1280px) { .viewer { grid-template-columns: 260px 1fr 300px; } }
@media (max-width: 1099px) {
  .viewer {
    grid-template-columns: 280px 1fr;
    grid-template-areas:
      "top top"
      "left stage"
      "foot foot";
  }
  .vw-right { display: none !important; }
}
@media (max-width: 900px) {
  .viewer {
    grid-template-columns: 1fr;
    grid-template-areas:
      "top"
      "stage"
      "foot";
  }
  .vw-left { display: contents; }
}
@media (max-width: 768px) {
  .viewer { grid-template-rows: 52px 1fr; grid-template-areas: "top" "stage"; }
  .vw-foot { display: none; }
}

/* ============================================================
   TOP BAR
   ============================================================ */
.vw-top {
  grid-area: top;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--rule);
  background: var(--base);
}
.vw-top-left, .vw-top-right { display: flex; align-items: center; gap: var(--space-4); }

.vw-brand {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 14px;
  letter-spacing: -0.02em;
  color: var(--fg-1);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.vw-brand svg { width: 16px; height: 16px; }
.vw-brand em { font-style: normal; color: var(--accent); }
.vw-sep { color: var(--fg-3); margin: 0 6px; font-weight: 300; }
.vw-case-id {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--fg-2);
  font-weight: 400;
}

.vw-crumb {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-3);
}
.vw-crumb b { color: var(--fg-1); font-weight: 500; }
@media (max-width: 1099px) { .vw-crumb { display: none; } }

.vw-icon-btn {
  width: 32px; height: 32px;
  display: inline-grid; place-items: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--fg-2);
  cursor: pointer;
  transition: background 120ms;
}
.vw-icon-btn:hover { background: var(--surface-3); color: var(--fg-1); }
.vw-icon-btn svg { width: 17px; height: 17px; }

.vw-share {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  background: var(--fg-1);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  letter-spacing: 0.01em;
}
.vw-share:hover { background: #000; }

/* ============================================================
   LEFT PANEL — wraps the existing #structures-panel.
   In desktop, the .panel inside fills the .vw-left slot.
   In mobile, .vw-left collapses (display:contents) and the
   .panel reverts to its bottom-sheet behavior.
   ============================================================ */
.vw-left {
  grid-area: left;
  border-right: 1px solid var(--rule);
  overflow: hidden;
  background: var(--base);
  position: relative;
}

/* ============================================================
   STAGE — fundo cinza-papel quase imperceptível
   ============================================================ */
.vw-stage {
  grid-area: stage;
  position: relative;
  background: var(--surface-canvas);
  overflow: hidden;
}
.vw-stage::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(21,23,26,0.06) 0%, rgba(21,23,26,0) 70%);
  pointer-events: none;
  z-index: 1;
}

/* ============================================================
   ZOOM CHIP (top-left of stage)
   ============================================================ */
.vw-zoom {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--base);
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  box-shadow: 0 4px 12px -4px rgba(21,23,26,0.10);
}
.vw-zoom-btn {
  width: 24px; height: 24px;
  border: 0;
  background: transparent;
  color: var(--fg-2);
  cursor: pointer;
  border-radius: 4px;
  display: grid; place-items: center;
}
.vw-zoom-btn:hover { background: var(--surface-3); color: var(--fg-1); }
.vw-zoom-btn svg { width: 14px; height: 14px; }
.vw-zoom-value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-1);
  font-weight: 500;
  padding: 0 6px;
}
@media (max-width: 768px) { .vw-zoom { display: none; } }

/* ============================================================
   LEGEND (bottom-right of stage)
   ============================================================ */
.vw-legend {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 5;
  padding: 12px 14px;
  background: var(--base);
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  box-shadow: 0 4px 12px -4px rgba(21,23,26,0.10);
  min-width: 180px;
  max-width: 240px;
}
.vw-legend-ttl {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-3);
  font-weight: 500;
  margin-bottom: 6px;
}
.vw-legend-rows { display: flex; flex-direction: column; gap: 6px; }
.vw-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-1);
  white-space: nowrap;
}
.vw-legend-dot {
  width: 10px; height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
@media (max-width: 768px) { .vw-legend { display: none; } }

/* ============================================================
   RIGHT PANEL (case meta + notes placeholder)
   Hidden by default; main.js flips data-show="true" if metadata.
   The breakpoint media query above also enforces display:none <1100px.
   ============================================================ */
.vw-right {
  grid-area: right;
  border-left: 1px solid var(--rule);
  overflow-y: auto;
  background: var(--base);
}
.vw-right[data-show="false"] { display: none; }

.vw-case-head { padding: var(--space-5); border-bottom: 1px solid var(--rule); }
.vw-case-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-3);
  margin-bottom: 6px;
  font-weight: 500;
}
.vw-case-title {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 21px;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  color: var(--fg-1);
}
.vw-case-pid {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-3);
}

.vw-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px var(--space-4);
  padding: var(--space-5);
  border-bottom: 1px solid var(--rule);
}
.vw-kv dt {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-3);
  font-weight: 500;
}
.vw-kv dd { margin: 0; font-size: 13px; color: var(--fg-1); font-weight: 500; }

/* ============================================================
   FOOT STRIP
   ============================================================ */
.vw-foot {
  grid-area: foot;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-5);
  border-top: 1px solid var(--rule);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-3);
  background: var(--base);
}
.vw-foot-stat { display: flex; align-items: center; gap: 6px; }
.vw-foot-stat b { color: var(--fg-1); font-weight: 500; }
.vw-dot-ok {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: var(--signal-ok);
  box-shadow: 0 0 0 3px rgba(46,125,91,0.18);
}

/* ============================================================
   STRUCTURES PANEL (preserved selectors — restyle only)
   Desktop ≥769px: lives inside .vw-left as a flow element.
   Mobile <769px: reverts to its bottom-sheet behavior.
   ============================================================ */
.panel {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: 100%;
  overflow-y: auto;
  padding: 0;
  border-radius: 0;
  background: var(--paper);
  color: var(--fg-1);
  z-index: 1;
}

.panel-title {
  font-family: var(--font-text);
  font-weight: 600;
  font-size: 15px;
  margin: 0;
  padding: var(--space-5) var(--space-5) var(--space-3);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--rule);
}
.panel-count {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-3);
}

.panel ul { list-style: none; }

.panel li {
  position: relative;
  padding: 12px 16px 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--rule);
}
.panel li:last-child { border-bottom: none; }
.panel li::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 12px;
  bottom: 14px;
  width: 3px;
  border-radius: 2px;
  background: var(--struct-color, transparent);
}

.structure-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.opacity-row { display: block; }

/* Slider — hairline track, 14px ink thumb */
.opacity-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 28px;
  background: transparent;
  cursor: pointer;
  margin: 0;
  padding: 0;
}
@media (hover: hover) and (pointer: fine) {
  .opacity-slider { height: 22px; }
}
.opacity-slider::-webkit-slider-runnable-track {
  height: 2px;
  background: var(--rule-strong);
  border-radius: 1px;
}
.opacity-slider::-moz-range-track {
  height: 2px;
  background: var(--rule-strong);
  border-radius: 1px;
}
.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fg-1);
  border: 2px solid var(--paper);
  box-shadow: 0 1px 3px rgba(21,23,26,0.25);
  margin-top: -6px;
  cursor: pointer;
}
.opacity-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fg-1);
  border: 2px solid var(--paper);
  box-shadow: 0 1px 3px rgba(21,23,26,0.25);
  cursor: pointer;
}

.structure-name {
  font-family: var(--font-text);
  font-size: 14px;
  font-weight: 500;
  color: var(--fg-1);
  flex: 1;
}

.eye-toggle {
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, border-color 0.15s;
}
.eye-toggle:hover { background: var(--surface-3); border-color: var(--rule-strong); }
.eye-toggle img {
  width: 18px;
  height: 18px;
  /* Theme is light, so the SVG renders ink-on-paper without inversion. */
}

/* Loading / error overlays — paper card with ink border */
.overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 16px 24px;
  border-radius: 8px;
  background: var(--paper);
  color: var(--fg-1);
  font-size: 14px;
  text-align: center;
  max-width: 80vw;
  border: 1px solid var(--rule-strong);
  box-shadow: 0 12px 32px -12px rgba(21,23,26,0.20);
  z-index: 100;
}
.overlay.error {
  border-color: var(--signal-err);
  color: var(--signal-err);
}

/* ============================================================
   MOBILE BOTTOM SHEET (≤768px) — keeps the existing JS contract
   ============================================================ */
@media (max-width: 768px) {
  .vw-left { display: contents; }
  .panel {
    position: fixed;
    top: auto;
    right: 0;
    left: 0;
    bottom: 0;
    width: 100%;
    max-width: 100%;
    height: var(--panel-height, 30vh);
    max-height: 90vh;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 20px -4px rgba(21,23,26,0.12);
    transition: height 0.25s ease-out;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: rgba(255,255,255,0.85);
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    border-top: 1px solid var(--rule-strong);
    z-index: 40;
  }
  .panel.is-dragging { transition: none; }
  .panel-handle {
    flex: 0 0 auto;
    height: 22px;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .panel-handle:active { cursor: grabbing; }
  .panel-handle::before {
    content: "";
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: rgba(21,23,26,0.22);
  }
  .panel-title { flex: 0 0 auto; padding: 4px 18px 10px; border-bottom: 1px solid var(--rule); }
  .panel ul { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; }
}
@media (min-width: 769px) { .panel-handle { display: none; } }

/* ============================================================
   MEASUREMENT (Sprint 3b.2) — selectors preserved, colors flipped
   ============================================================ */

/* CSS2DObject pill — sits over the canvas, must read on light bg */
.measurement-pill {
  background: var(--accent);
  color: #fff;
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 4px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(21,23,26,0.30);
  pointer-events: none;
  user-select: none;
  transform: translate(-50%, -50%);
  position: relative;
}

.measurement-endpoint-label {
  background: var(--fg-1);
  color: var(--accent);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--accent);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  transform: translate(8px, calc(-100% - 4px));
}

/* FAB de entrada/saída do modo de medição (top-right da stage) */
.measure-fab {
  position: fixed;
  top: 16px;
  right: 16px;
  height: 44px;
  min-width: 44px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.92);
  color: var(--fg-1);
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  font-family: var(--font-text);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  z-index: 50;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 4px 12px -4px rgba(21,23,26,0.12);
}
.measure-fab:hover { border-color: var(--fg-1); }
.measure-fab[data-state="cancel"] {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.measure-fab svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.measure-fab[hidden] { display: none; }

@media (max-width: 768px) {
  .measure-fab {
    width: 48px;
    height: 48px;
    min-width: 48px;
    padding: 0;
    justify-content: center;
  }
  .measure-fab .label { display: none; }
}

/* Hint banner — dark HUD over light canvas, per mobile mockup insight */
.measure-hint {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(11,14,17,0.82);
  color: #fff;
  font-family: var(--font-text);
  font-weight: 500;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 999px;
  pointer-events: none;
  z-index: 49;
  white-space: nowrap;
  border: 1px solid rgba(255,255,255,0.18);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.measure-hint[hidden] { display: none; }

/* Mini-toolbar (bottom-center). Buttons keep their class names. */
.measure-toolbar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 1000;
}
.measure-toolbar[hidden] { display: none; }

@media (max-width: 768px) {
  .measure-toolbar {
    bottom: calc(30vh + 16px);
    width: calc(100% - 16px);
    max-width: 480px;
  }
  .measure-toolbar button {
    flex: 1;
    justify-content: center;
  }
}

.measure-toolbar button {
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-family: var(--font-text);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  border: 1px solid transparent;
}

.measure-toolbar .btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  box-shadow: 0 6px 16px -4px rgba(200,65,44,0.40);
}
.measure-toolbar .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.measure-toolbar .btn-secondary {
  background: rgba(11,14,17,0.82);
  color: #fff;
  border-color: rgba(255,255,255,0.18);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.measure-toolbar .btn-secondary:hover { border-color: #fff; }

/* Lupa — DOM wrapper sobre o canvas dedicado da lupa */
.measure-loupe {
  position: fixed;
  width: 100px;
  height: 100px;
  pointer-events: none;
  z-index: 52;
  transform: translate(-50%, -100%);
  display: none;
}
.measure-loupe[data-visible="true"] { display: block; }
.measure-loupe[data-flip="below"] { transform: translate(-50%, 0); }

.measure-loupe-frame {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid #fff;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(21,23,26,0.40);
  background: rgba(11,14,17,0.42);
  position: relative;
}

.measure-loupe-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.measure-loupe-crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
}
.measure-loupe-crosshair::before,
.measure-loupe-crosshair::after {
  content: "";
  position: absolute;
  background: var(--accent);
}
.measure-loupe-crosshair::before { left: 50%; top: 0; width: 1.5px; height: 100%; transform: translateX(-50%); }
.measure-loupe-crosshair::after  { top: 50%; left: 0; height: 1.5px; width: 100%; transform: translateY(-50%); }

.measure-loupe-tail {
  position: absolute;
  width: 0;
  height: 0;
  left: 50%;
  bottom: -14px;
  transform: translateX(-50%);
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 14px solid #fff;
}
.measure-loupe[data-flip="below"] .measure-loupe-tail {
  bottom: auto;
  top: -14px;
  border-top: none;
  border-bottom: 14px solid #fff;
}

.measure-loupe-label {
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(11,14,17,0.82);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
.measure-loupe-label[hidden] { display: none; }

/* ============================================================
   AR — ar.js inserts these into <body>; same selectors preserved
   ============================================================ */
.ar-root {
  position: fixed;
  left: -9999px;
  top: -9999px;
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
}

.ar-button {
  position: fixed;
  top: 22px;
  right: 80px;
  height: 36px;
  padding: 0 14px;
  display: none;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.92);
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  font-family: var(--font-text);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
  z-index: 50;
  transition: background 120ms ease, border-color 120ms ease;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 4px 12px -4px rgba(21,23,26,0.10);
}

.ar-button[data-visible="true"] { display: inline-flex; }
.ar-button:hover { background: var(--accent); color: #fff; }
.ar-button[data-loading="true"] { opacity: 0.65; cursor: progress; }

@media (max-width: 768px) {
  .ar-button {
    top: 22px;
    right: 84px;
    height: 36px;
    font-size: 12px;
  }
}

/* Modal QR (desktop) */
.ar-modal {
  position: fixed;
  inset: 0;
  background: rgba(11,14,17,0.65);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ar-modal[data-visible="true"] { display: flex; }

.ar-modal-content {
  background: var(--paper);
  border-radius: 12px;
  padding: 28px 24px 22px;
  max-width: 360px;
  width: 90%;
  text-align: center;
  position: relative;
  font-family: var(--font-text);
  color: var(--fg-1);
  box-shadow: 0 24px 60px -16px rgba(21,23,26,0.40);
  border: 1px solid var(--rule);
}

.ar-modal-close {
  position: absolute;
  top: 6px;
  right: 12px;
  background: none;
  border: none;
  color: var(--fg-1);
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
}
.ar-modal-close:hover { color: var(--accent); }

.ar-modal-qr {
  margin: 8px auto 14px;
  width: 240px;
  height: 240px;
  background: #fff;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--rule);
}
.ar-modal-qr img {
  width: 100%;
  height: 100%;
  display: block;
}

.ar-modal p {
  font-family: var(--font-text);
  font-size: 14px;
  margin: 0;
  line-height: 1.4;
  color: var(--fg-2);
}
```

- [ ] **Step 2: Verify the file has no `--pp-*` or `#00d4ff` leftovers**

```bash
grep -nE "\-\-pp-|#00d4ff" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/style.css || echo "no leftovers"
```

Expected: `no leftovers`.

- [ ] **Step 3: Verify the preserved selectors are still present**

```bash
grep -cE "\.panel\b|\.panel-handle|\.panel-title|\.structure-row-main|\.opacity-row|\.opacity-slider|\.structure-name|\.eye-toggle|\.measurement-pill|\.measurement-endpoint-label|\.measure-fab|\.measure-hint|\.measure-toolbar|\.measure-loupe|\.ar-button|\.ar-modal|\.ar-root" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/style.css
```

Expected: ≥ 17 matches (one per selector at minimum; many appear in multiple rules).

- [ ] **Step 4: Brace balance check**

```bash
python3 -c "
with open('/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/style.css') as f:
    content = f.read()
opens = content.count('{')
closes = content.count('}')
print(f'opens={opens} closes={closes}')
assert opens == closes
print('OK')
"
```

Expected: OK.

---

## Task 4 — `case-next/main.js`: post-bootstrap UI population + handlers

**Files:**
- Modify: `case-next/main.js`

The current `bootstrap()` ends with `ar.init(...)`. We add a new function `bindRedesignChrome(world, structures, uid, glbBytes)` and call it after `dom.initBottomSheet()` (before `ar.init`). All the new chrome wires up through `data-bind=""` and `data-action=""` attributes injected by the new HTML.

The GLB size in MB needs the byte length. We capture it from the `loader.loadGlb` result — currently `loader.js` returns `{ root }`. We'll extend it to return `{ root, byteLength }`. That's a small `loader.js` change too — let me include it here in the same task.

- [ ] **Step 1: Patch `loader.js` to surface byteLength**

Read `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/loader.js` and find where it returns the parsed GLB object. It currently fetches and parses, returning `{ root }`. After this patch it returns `{ root, byteLength }`.

```bash
grep -n "return\|fetch\|gltf" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/loader.js
```

Look at the output, find the return statement. Add `byteLength` based on the fetched buffer's `byteLength` (or `.size` if it's a Blob).

Open the file and edit. Without seeing the exact existing source, here is the pattern: when the code does something like `const arrayBuffer = await response.arrayBuffer();`, capture `arrayBuffer.byteLength` and include it in the return.

Replace the return block. If the file currently has:
```js
return { root };
```
change it to:
```js
return { root, byteLength };
```
And earlier in the function, where `arrayBuffer` (or equivalent) is created, capture:
```js
const byteLength = arrayBuffer.byteLength;
```
If the file uses `Blob` or `Response.blob()`, use `blob.size` instead and rename the local variable consistently.

If you can't find a clean place to capture it without rewriting the loader, **skip this step** and instead size the footer with a placeholder (`—`). The redesign tests don't assert the size value, only that the `<span>` exists.

- [ ] **Step 2: Patch `main.js`**

Open `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/main.js`.

(a) Update the destructuring after `await loader.loadGlb(url)`. Find:
```js
    ({ root } = await loader.loadGlb(url));
```
Replace with:
```js
    ({ root, byteLength } = await loader.loadGlb(url));
```
And at the top of `bootstrap()`, change the `let` declaration block to include `byteLength`:
```js
  let root, byteLength;
```
(If `let root;` already exists in some form, add `byteLength` to the same declaration. If the variable was declared inline with `let { root } = ...`, switch to the two-step version above.)

If you skipped Step 1, leave `main.js` declaring just `root`, and pass `null` for `byteLength` to `bindRedesignChrome`.

(b) After `dom.initBottomSheet();` line, before `ar.init({ world, dom, uid });`, insert:

```js
  bindRedesignChrome(structures, uid, byteLength);
```

(c) Append this function definition at the end of the file, after the `bootstrap()` function and before the `if (window.__playwrightTest)` block:

```js

// ============================================================
// REDESIGN CHROME — populates the new viewer chrome (top bar / zoom /
// legend / case-head / foot strip) and wires the handlers. Pure DOM,
// reads from world/dom/loader results.
// ============================================================

function bindRedesignChrome(structures, uid, byteLength) {
  // --- Top bar / case head / foot — text bindings ---
  const uidShort = uid.slice(0, 8);
  setBind("uid-short", uidShort);
  setBind("case-title", `Caso ${uidShort}`);
  setBind("case-pid", `ID ${uid}`);
  setBind("kv-count", `${structures.length} camadas`);
  setBind("structure-count", `${structures.length} ${structures.length === 1 ? "camada" : "camadas"}`);
  setBind("foot-count", String(structures.length));
  setBind("foot-size", byteLength ? `${(byteLength / (1024 * 1024)).toFixed(1)} MB` : "—");

  // Crumb — first 2 structure names if available
  const crumbEl = document.querySelector('[data-bind="crumb"]');
  if (crumbEl && structures.length >= 2) {
    const a = humanizeName(structures[0].name);
    const b = humanizeName(structures[1].name);
    crumbEl.innerHTML = `Reconstrução · <b>${escapeHtml(a)} + ${escapeHtml(b)}</b>`;
  }

  // Legend rows
  const legendRows = document.querySelector('[data-bind="legend-rows"]');
  if (legendRows) {
    legendRows.innerHTML = "";
    for (const { name, color } of structures) {
      const row = document.createElement("div");
      row.className = "vw-legend-row";
      const dot = document.createElement("span");
      dot.className = "vw-legend-dot";
      if (color) dot.style.background = color;
      const label = document.createElement("span");
      label.textContent = humanizeName(name);
      row.appendChild(dot);
      row.appendChild(label);
      legendRows.appendChild(row);
    }
  }

  // --- Top-bar actions ---
  wireAction("reset-camera", () => world.frameToScene());
  wireAction("fullscreen", toggleFullscreen);
  wireAction("share", shareCurrentUrl);

  // --- Zoom chip ---
  wireAction("zoom-in", () => { world.zoomBy(1.2); updateZoomPct(); });
  wireAction("zoom-out", () => { world.zoomBy(1 / 1.2); updateZoomPct(); });
  world.onCameraChange(updateZoomPct);
  updateZoomPct();
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

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.body.requestFullscreen?.();
  }
}

async function shareCurrentUrl() {
  const url = window.location.href;
  try {
    await navigator.clipboard?.writeText(url);
  } catch {
    // Clipboard API blocked (insecure context, denied permission, etc.).
    // Fallback: select the URL in a hidden textarea and execCommand copy.
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
}

function humanizeName(name) {
  return String(name).replace(/_/g, " ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
```

- [ ] **Step 3: Open in browser and smoke-test**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx http-server -p 5500 -c-1 . &
```

Open `http://127.0.0.1:5500/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4`. Verify:
- New top bar renders with "Medcase." and "caso 5fc6c4d2".
- Left panel is white with hairlines (was dark).
- Stage has a barely-gray background (was dark `#272425`).
- Zoom chip top-left of stage shows "100%".
- Legend bottom-right shows structure names with color dots.
- Foot strip at bottom shows "Segmentação validada", "Render · WebGL2 · N camadas · X.X MB", "v1 · Medcase / Dasa".
- Right panel hidden in viewport <1100px; appears on wide screens.
- Measure FAB top-right is now coral-bordered ink pill (was cyan-bordered dark).
- Click Medir — hint banner, toolbar appear (dark HUD over light canvas).
- Eye toggle works; opacity slider works (now ink thumb on hairline track).

Stop the server.

If the UID `5fc6c4d2d77d4ab6a8cadfe8996c70a4` doesn't load, use `test-fixture-abc123` and run with Playwright's fixture intercept instead — but for the smoke we want a real R2 case.

---

## Task 5 — New Playwright suite: `case-next-redesign.spec.js`

**Files:**
- Create: `tests/case-next/case-next-redesign.spec.js`

Mirrors the structure of `tests/case-next/case-next.spec.js` (which uses a fixture GLB intercepted at the R2 URL — read it for the pattern).

- [ ] **Step 1: Inspect the existing fixture-intercept pattern**

```bash
head -80 /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/tests/case-next/case-next.spec.js
```

Look at how `TEST_UID`, `FIXTURE_PATH`, and `page.route()` work. Replicate the same setup in the new spec.

- [ ] **Step 2: Create the spec file**

Write to `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/tests/case-next/case-next-redesign.spec.js`:

```javascript
// @ts-check
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");
const TEST_UID = "test-fixture-abc123";
const VIEWER_URL = `/case-next/?id=${TEST_UID}`;

async function interceptR2(page, fixtureBuffer) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "model/gltf-binary", "access-control-allow-origin": "*" },
      body: fixtureBuffer,
    });
  });
}

test.describe("case-next redesign chrome", () => {
  let fixtureBuffer;
  test.beforeAll(async () => {
    fixtureBuffer = await fs.readFile(FIXTURE_PATH);
  });

  test("top bar: brand wordmark, short UID, action buttons present", async ({ page }) => {
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);
    await page.goto(VIEWER_URL);

    const brand = page.locator(".vw-brand");
    await expect(brand).toContainText("Medcase");
    await expect(page.locator(".vw-case-id [data-bind=\"uid-short\"]")).toHaveText(TEST_UID.slice(0, 8));

    for (const action of ["reset-camera", "fullscreen", "share"]) {
      await expect(page.locator(`[data-action="${action}"]`)).toBeVisible();
    }
  });

  test("zoom chip: visible in desktop, percentage shown, +/- buttons change value", async ({ page, isMobile }) => {
    test.skip(isMobile, "Zoom chip hidden under 768px viewport.");
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);
    await page.goto(VIEWER_URL);

    const zoom = page.locator(".vw-zoom");
    await expect(zoom).toBeVisible();
    await expect(page.locator('[data-bind="zoom-pct"]')).toHaveText(/^\d+%$/);

    const valueBefore = await page.locator('[data-bind="zoom-pct"]').textContent();
    await page.locator('[data-action="zoom-in"]').click();
    await expect(page.locator('[data-bind="zoom-pct"]')).not.toHaveText(valueBefore || "");
  });

  test("legend: renders one row per structure with colored dot", async ({ page, isMobile }) => {
    test.skip(isMobile, "Legend hidden under 768px viewport.");
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);
    await page.goto(VIEWER_URL);

    await page.waitForSelector(".vw-legend-row");
    const rows = page.locator(".vw-legend-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < count; i++) {
      const dot = rows.nth(i).locator(".vw-legend-dot");
      await expect(dot).toBeVisible();
      const bg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
      // Should be a non-transparent color (e.g., "rgb(196, 167, 138)" for tissue tan).
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(bg).not.toBe("transparent");
    }
  });

  test("foot strip: visible in desktop, shows structure count and webgl tag", async ({ page, isMobile }) => {
    test.skip(isMobile, "Foot strip hidden under 768px viewport.");
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);
    await page.goto(VIEWER_URL);

    const foot = page.locator(".vw-foot");
    await expect(foot).toBeVisible();
    await expect(foot).toContainText("WebGL2");
    await expect(foot).toContainText("v1");

    // Wait for structure count to be populated (it starts as "—" before bootstrap finishes).
    await expect(page.locator('[data-bind="foot-count"]')).not.toHaveText("—", { timeout: 10000 });
  });

  test("right panel: hidden when viewport < 1100px (and even when wider, hidden by default until populated)", async ({ page, isMobile }) => {
    test.skip(isMobile, "Right panel never shows on mobile.");
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);

    // Desktop viewport is 1280×800 by default; right panel exists in DOM but
    // CSS media query <1100 hides it. Our default config is wider, so the panel
    // is in the layout but data-show="false" keeps it hidden.
    await page.goto(VIEWER_URL);
    const right = page.locator(".vw-right");
    await expect(right).toHaveCount(1);
    const showAttr = await right.getAttribute("data-show");
    expect(showAttr).toBe("false");
  });

  test("mobile: zoom chip, legend and foot strip are hidden", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Asserts mobile-only collapsing.");
    await page.addInitScript(() => { window.__playwrightTest = true; });
    await interceptR2(page, fixtureBuffer);
    await page.goto(VIEWER_URL);

    for (const sel of [".vw-zoom", ".vw-legend", ".vw-foot"]) {
      await expect(page.locator(sel)).toBeHidden();
    }
    // Top bar still visible on mobile.
    await expect(page.locator(".vw-top")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the new spec**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test tests/case-next/case-next-redesign.spec.js --reporter=list 2>&1 | tail -60
```

Expected: all 6 tests pass on desktop project; mobile project skips the desktop-only ones and runs the mobile-only one. If `zoom-pct` doesn't change after click, the `world.zoomBy` may not be hooked correctly — debug `main.js` `wireAction("zoom-in", ...)`.

---

## Task 6 — Full regression + commit

**Files:** none modified (verify + commit).

- [ ] **Step 1: Full Playwright run across all projects**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test --reporter=list 2>&1 | tail -120
```

Expected: all tests pass:
- `tests/site/*` (6 marketing tests × 2 projects = 12, with 1 skip on mobile).
- `tests/case-next/case-next.spec.js` (~28 × 2 = ~56 tests).
- `tests/case-next/case-next-ar.spec.js` (~24 × 2 = ~48 tests).
- `tests/case-next/case-next-redesign.spec.js` (6 × 2 = 12, with several mobile/desktop skips).

If any case-next regression appears, it's likely because:
- A CSS class was accidentally renamed.
- The `.measure-fab` got positioned out of the viewport (verify `top:16px; right:16px` reaches the right edge of the stage, not the wrapper).
- The bottom-sheet drag stopped working — check the `@media (max-width:768px) { .panel { ... position:fixed } }` rule.

- [ ] **Step 2: Commit**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git status --short
```

Stage only the redesign files:

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git add case-next/index.html case-next/style.css case-next/world.js case-next/main.js case-next/loader.js tests/case-next/case-next-redesign.spec.js docs/superpowers/specs/2026-05-13-viewer-redesign-design.md docs/superpowers/plans/2026-05-13-viewer-redesign.md
```

(If you skipped the `loader.js` byteLength patch, drop that file from the `git add`.)

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git commit -m "$(cat <<'EOF'
feat(case-next): redesign viewer chrome per Claude Design handoff

Flip the Three.js viewer at /case-next/ from the dark cyan shell to
the editorial clinical-light register: paper canvas (#EDEFF2),
hairlines instead of card lifts, single coral accent (#C8412C),
Plus Jakarta Sans + Inter + JetBrains Mono via colors_and_type.css.

- world.js: COLOR_CYAN → COLOR_ACCENT (#C8412C). scene.background
  flipped to #EDEFF2. New zoomBy() and getZoomPercentage() helpers
  for the floating zoom chip.
- case-next/index.html: wraps the canvas in a .viewer 3-col grid
  (left structures + stage + right meta) with a top bar (brand +
  crumb + reset/fullscreen/share) and a foot strip (telemetry).
  Preserves <canvas id="canvas">, <aside id="structures-panel">,
  loading/error overlays, and <div id="ar-root">.
- case-next/style.css: full restyle. Light theme. Preserves every
  selector the JS modules and Playwright suite reference (.panel,
  .panel-handle, .panel-title, .structure-row-main, .opacity-row,
  .opacity-slider, .structure-name, .eye-toggle, .measurement-*,
  .measure-fab, .measure-hint, .measure-toolbar, .measure-loupe*,
  .ar-button, .ar-modal*, .ar-root). New rules for .viewer, .vw-*.
- case-next/main.js: post-bootstrap chrome wiring — populates the
  top bar, foot strip, legend, case head; binds reset-camera,
  fullscreen, share, zoom-in/out actions to world / browser APIs.
- tests/case-next/case-next-redesign.spec.js: 6 new scenarios
  covering the new chrome (top bar, zoom, legend, foot strip,
  right panel hidden state, mobile collapsing).

Existing case-next and AR suites pass unchanged — JS contracts
and data-testid hooks are preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify commit**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git log -1 --stat
```

Expected: ~7 files changed in the latest commit (index.html, style.css, world.js, main.js, [loader.js], test spec, design doc, plan doc).

---

## Done criteria

- [ ] `/case-next/?id=<uid>` renders with the new layout: paper canvas, top bar, foot strip, zoom chip, legend, structures panel on the left.
- [ ] Body bg is white (was `#272425`).
- [ ] Coral (`#C8412C`) replaces cyan everywhere: outline pass, measurement endpoints, measurement line, measure FAB hover, AR button border.
- [ ] All existing case-next tests pass (`tests/case-next/case-next.spec.js`, `tests/case-next/case-next-ar.spec.js`).
- [ ] New redesign tests pass (`tests/case-next/case-next-redesign.spec.js`).
- [ ] Site tests still pass (`tests/site/site.spec.js`).
- [ ] No selector renames in the restyle — every `data-testid` and DOM hook the JS modules or tests use is preserved.
