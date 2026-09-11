# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

medCaseViewer is a medical 3D surgical planning visualization tool built for the Brazilian healthcare market (Dasa network). It uses the Sketchfab API to render interactive 3D anatomical models with custom overlay tools for measurements, opacity control, and reporting.

## Development

**No build system** - This is a static HTML/CSS/JS project with no npm, webpack, or bundling.

### Running Locally

Use VS Code Live Server extension (configured on port 5501):
- Open project in VS Code
- Right-click `index.html` or `case/index.html` → "Open with Live Server"

Alternatively, any static file server works:
```bash
python -m http.server 8080
# or
npx serve .
```

### Debugging

Chrome debugging is pre-configured in `.vscode/launch.json` for `http://localhost:8080`.

## Architecture

### Project Structure

- `/index.html` - Marketing/landing page (standalone, uses Tailwind CSS via CDN)
- `/colors_and_type.css` - Brand primitives: webfont import, type scale, spacing, radius, brand palette. Loaded by every page.
- `/app.css` - **The app surface layer, shared by `/case/` and `/upload/`.** Theme tokens (`--w-*`, light + dark), reset, the 56px top bar and brand lockup, the `.pill` system, `.btn` / `.input` / `.select` / `.field-label` / `.struct-tag` / `.note`, the link+copy row, and the stage vignette (`--w-vignette`). The landing page does NOT load it, which is why it can style bare elements. See "Design system" below.
- `/theme.js` - `initTheme`/`setTheme`/`toggleTheme`/`onThemeChange`, one `localStorage` key. Used by `/case/` only — `/upload/` is light-only.
- `/case/` - The 3D viewer application (native Three.js r0.164)
  - `index.html` - Viewer template: Three.js `<canvas>` + importmap (three, addons, n8ao)
  - `main.js` - Bootstrap: reads `?id`, loads the GLB, wires the tool rail (Medir + Contorno), structures panel, theme toggle, share/AR
  - `world.js` - Three.js scene: renderer, lighting + IBL, tone mapping, N8AO, OrbitControls, outline pass (see Rendering pipeline)
  - `loader.js` - GLB fetch from Cloudflare R2 (`cases/{uid}.glb`), with a Sketchfab probe → `legacy/` fallback
  - `dom.js` - DOM helpers: structures panel, loading/error overlays, tool rail, measurement menu + hint banner, Contorno card/traço/aviso
  - `measurement.js` / `volume.js` / `calibre.js` / `calibre-geom.js` - the three measurement modes (see Measurement Modes)
  - `contour.js` / `contour-geom.js` - the Cortar tool: cut part of a structure with a freehand contour, keeping the mesh closed (see Cortar)
  - `ar.js` - "Ver em AR" handoff (model-viewer)
  - `legacy/` - the old Sketchfab-iframe viewer (`main.js`, `measure.js`, `opacity.js`, `mudaCor.js`, `laudo.js`, `mainLinhaLaudo.js`, `botao_video.js`), served as a fallback for cases that exist only on Sketchfab
- `/upload/` - Clinician self-service upload page (talks to the `mesh-processor` backend)
  - `index.html` - Multi-file STL input, 4-state UI (idle / processing / done / error). Same CSS stack as the viewer (`colors_and_type.css → app.css → upload.css`); no Tailwind. **Light theme only** (see Theme System).
  - `upload.css` - Only what is specific to this screen: stage + sheet, dropzone, structure list + rail, reference menu, hesitation card, progress rail.
  - `upload.js` - ES module. Posts files to `POST /upload`, then polls `GET /status/{uid}` until ready

### Key Technical Details

**URL Parameters**:
- `?id=UID` - Load a case by UID. `loader.js` fetches `cases/{uid}.glb` from Cloudflare R2; on a 404 it probes the Sketchfab API and, if found, redirects to the `legacy/` Sketchfab viewer.

**Design system**: the viewer is the source of truth and `/app.css` is where its vocabulary lives; `/upload/` consumes it rather than inventing its own. Consequences to respect when adding UI:
- Never introduce a raw hex or a foreign gray in an app screen. Everything comes from `--w-*` (theme-aware) or `colors_and_type.css` (`--space-*`, `--radius-*`, `--font-*`, `--ease-*`).
- Coral has two tokens because it plays two roles: `--w-accent` is the **fill** (measurement pills, progress rail) and stays constant across themes so white text on it keeps contrast; `--w-accent-fg` is coral as **text/border** on an app surface and lightens in the dark theme to clear 4.5:1. Use `--w-accent-fg` for anything you're only tinting.
- The primary action is ink-filled (`.pill.primary` / `.btn-primary`), not colored. Coral is reserved for measurement and clinical highlight. (`--w-highlight` `#FFE100` used to be the "dentro de" piece's color; the backend now paints that piece as a lighter tone of its origin structure, so the upload screen no longer uses it.)
- Signals use `--w-ok` / `--w-warn` / `--w-err`, not the brand's `--signal-*` (those are calibrated for a light background only and vanish on the dark canvas).
- `[hidden] { display: none !important; }` lives in `app.css`. Both screens drive visibility through the `hidden` attribute, whose UA `display:none` loses to any class that declares `display` (`.btn`, `.note`, `.link-row`). Without that rule a `<button class="btn" hidden>` stays on screen.

**Theme System**: `/theme.js` (`initTheme`/`setTheme`/`toggleTheme`/`onThemeChange`) toggles `html[data-theme]` — **dark by default**, persisted in `localStorage` under `medcase-viewer-theme`. **Only `/case/` uses it.** `/upload/` is light-only and neither imports `theme.js` nor carries a toggle: the viewer is dark because a 3D model sits on a stage, while the upload screen is a form read in a bright clinic between reports. The `--w-*` light values are the CSS default, so the upload page simply never writes `data-theme`. `/case/` writes `data-theme` in an inline `<head>` script so there is no flash before the module loads. CSS variables (`--w-*`, in `app.css`) flip per theme; `case/main.js` subscribes via `onThemeChange` to read `--w-canvas-bg` and push it into the Three.js `scene.background`, since WebGL can't react to CSS variables.

**Legacy Sketchfab viewer (`/case/legacy/`)**: the pre-Three.js viewer. Uses Sketchfab Viewer API v1.9.0 (global `api`), `mudaCor.js` for theming, and an SVG-overlay measurement tool via `getWorldToScreenCoordinates`. Supports `?autospin=` and `?yt=` params. Reached only via the R2-miss → Sketchfab fallback above.

**Rendering pipeline (`/case/world.js`)**: image formation tuned for product/medical realism:
- **Tone mapping**: `NeutralToneMapping` at `toneMappingExposure = 0.85` — faithful colors with a soft highlight rolloff (avoids ACESFilmic's cinematic desaturation and pure-white clipping).
- **Image-based lighting**: a Polyhaven `studio_small_09_1k.hdr` (~1.6MB) is fetched at runtime from `dl.polyhaven.org`, PMREM-prefiltered into `scene.environment` (`environmentIntensity = 1.0`); its softboxes read as crisp studio highlights. A synthetic `RoomEnvironment` lights the first frames and stays as a graceful fallback if the HDR fetch fails. The HDR lights the scene only — it is never shown as a skybox.
- **Light rig**: `HemisphereLight` + key + fill `DirectionalLight`s at moderate intensity — adds subtle direction and guarantees the magnifier's second `WebGLRenderer` (no shared PMREM env) is lit, without drowning the IBL or flattening the AO.
- **Ambient occlusion**: `N8AOPass` (pmndrs/n8ao, screen-space) in the `EffectComposer` — softer/faster than the native SSAOPass; supplies the contact shadows that give concavities depth. `aoRadius`/`distanceFalloff` are rescaled to the model's bounding radius in `frameToScene()`.
- **Background**: a flat `scene.background` kept in sync with the CSS `--w-canvas-bg` token via `setSceneBackground()` (light `#EDEFF2` / dark `#181818`), plus a soft radial vignette on `.vw-stage::before` (smoothstep falloff that eases out at the corners) for photographic depth.

**Tool rail (`/case/`)**: tools that act on the model live in a floating rail on the left edge of the stage (same glass as the zoom chip, below it): **Medir** (opens the Linear/Volume/Calibre menu to the right of the rail; keeps `data-testid="measure-fab"`) and **Cortar** (`data-testid="contour-button"`). One tool at a time: `rail.setActive(tool)` presses the active button and disables the other; a measurement mode unlocks the rail through its `onExit`. Desfazer appears in the rail only after the first cut (there is deliberately no "Restaurar" — undo steps back, reload shows the full GLB).

**Mobile layout (≤768px, CSS in the "CELULAR" block of `case/style.css` + `main.js`)**: the same tool rail becomes a **bottom bar** — Estruturas · Medir · Cortar, always labeled, in thumb reach (design settled in the "Versão 5" canvas round). Desktop is untouched: every rule lives under `max-width: 768px` and the JS branches on `matchMedia("(max-width: 768px)")`.
- **Estruturas** (`data-testid="sheet-toggle"`, mobile-only button inside the rail) opens/closes the structures bottom sheet, which now rests on top of the bar (`bottom: var(--mbar-h)`). The case opens with the sheet open, as before.
- Entering a mode (Medir or Cortar) hides the bar (`.vw-rail[data-mode]`) and closes the sheet; leaving restores the sheet as it was — except after a cut, which keeps it closed so the result is visible. The measure menu is a sheet above the bar; measure toolbars sit at the bottom edge while a mode is on.
- **Cortar on mobile**: the bar is replaced by the mode bar (`dom.mountModeBar`: Cancelar · "Cortar / N cortes feitos" · Desfazer). The choice card becomes a bottom sheet in place of the mode bar (only the list scrolls; Área and Cortar stay visible). On touch devices (`pointer: coarse`) one finger draws with the shared loupe above it, and two fingers rotate/zoom (`world.setContourTouchNavigation`: OrbitControls `touches = {ONE: null, TWO: DOLLY_ROTATE}`) — a second finger discards the stroke/choice in progress, since the contour is screen-space. Any camera change while drawing/choosing (`world.onCameraChange`, e.g. two fingers, trackpad pinch) or a resize does the same, and damping is off for the whole mode (`stopCameraInertia` on start) so the camera can't drift after the stroke. The cutter prism is built before any await in `_apply`. Undo in the mode bar keeps the tool on.
- Keep testids unique across layouts: the bar *is* the rail restyled, so `measure-fab` / `contour-button` work in both Playwright projects; mobile-only controls are `sheet-toggle`, `mode-bar`, `mode-cancel`, `mode-undo`.

**Cortar (`contour.js` + `contour-geom.js` + the "Cortar" section at the end of `world.js`)**: cut part of one or more structures with a freehand contour. The label is a verb on purpose: the tool *cuts* — it is not hiding (that's the eye) nor deleting a whole structure. Session-only — nothing is persisted.
- Flow: Cortar → drag on the canvas (OrbitControls and the zoom chip are disabled for the whole mode, since the contour is screen-space) → release closes it → a card next to the contour lists **only the visible structures the contour crossed** (hidden structures are protected), with checkboxes, `Área: Dentro | Fora` and a live preview → "Cortar" → toast with Desfazer. A new drag while the card is open redraws. Esc/Cancelar/clicking Cortar again exits.
- Freehand cleanup (`contour-geom.tidyLoop` + `dropCollinear`): overshooting the start point is trimmed to the loop; a figure-eight is refused (no clear "inside"); collinear points are dropped because earcut silently skips them, which would leave the cutter prism open.
- **Watertight cut**: the contour becomes a prism along the view rays (from before the model's bounding sphere to past it; caps = earcut of the screen polygon), and each chosen structure is cut with a **boolean in Manifold** (`manifold-3d@3.5.3`, WASM via unpkg, lazy-loaded on the first cut): `subtract` for Dentro, `intersect` for Fora. The opening comes out **capped** and the mesh stays closed, so Volume keeps working on a cut structure. GLBs from mesh-processor are index-manifold and go in as-is; an already-cut mesh (non-indexed after `toCreasedNormals`) goes through `Mesh.merge()`. Never weld everything by position before handing it to Manifold — it pinches vertices where two surfaces touch and Manifold refuses. A mesh that isn't closed fails with a toast naming it; the rest of the cut still applies. Normals are rebuilt with `toCreasedNormals(45°)`: smooth organ surface, crisp rim where the cap meets it.
- The preview is only approximate (triangles whose projected centroid falls inside the polygon, shown as a translucent ghost); the exact boolean runs on confirm. Undo swaps the previous geometry back (`applyMeshCut` returns it as a token). Volume/calibre caches are invalidated per cut mesh, and the volume's closed-mesh check counts edges by position (so creased duplicates still count as closed).
- The preview ghost is a child mesh whose geometry shares the real mesh's position/normal attributes — never `dispose()` it (that would free GPU buffers the real mesh still uses); it is rebuilt when the mesh's geometry changes.
- A cut structure shows "Parte removida" on its panel row until undone — a persistent reminder that the model is incomplete.

**Measurement Modes (`/case/` Three.js viewer)**: three modes share the rail's Medir button + dropdown:
- **Linear** (`measurement.js`): 2-point Euclidean distance in mm, drawn as a Line2 with a label pill at the midpoint.
- **Volume** (`volume.js`): tap a mesh; computes real volume in cm³ via signed-tetrahedron sum over its triangles. Detects non-manifold meshes (open edges) and shows a `~` warn pill.
- **Calibre** (`calibre.js` + `calibre-geom.js`): tap one or two points on a vessel surface. Cast ray inward from P1 to find the opposite lumen wall → midpoint = local center C0. PCA over nearby vertices gives the centerline tangent. Iterative marching cuts cross-section polygons perpendicular to the tangent and recenters on each polygon's centroid, until the mesh boundary is reached, a bifurcation is detected (area > 4× previous), or P2 is reached. The centerline is rendered as a glowing inner Line2 (`depthTest:false`). Clicking on the centerline drops a circle perpendicular to the local tangent with diameter = `2·√(area/π)` (equivalent-circle diameter — clinical standard). Drag-along-centerline re-runs `diameterAt` on every pointermove. Multi-vessel meshes are handled by picking the polygon whose centroid is closest to the last centerline point.

**Future work — vessel centerline service**: the current calibre centerline extraction is a local marching algorithm in JS. It works well for straight/curved single vessels but can fail on branched topology. A more robust approach would be a Python service (similar to `mesh-processor` on Railway) running VTK or skimage skeletonization to precompute centerlines per mesh during upload. The viewer would then download the centerline polylines alongside the GLB and the calibre mode would be reduced to "click on the precomputed centerline → measure", removing the marching algorithm entirely.

**Upload flow (`/upload/`)**: Two-phase to accommodate Sketchfab's async server-side processing:
1. `POST /upload` with a `FormData` containing each STL under the repeated field name `files` (not `files[]`). Response is immediate and contains `{uid, viewer_url, ...}`.
   - The idle state is **one screen**. Isolating is optional, so it never costs a step to everyone: the typical case is 4 STLs with no isolation at all. Choosing files swaps the dropzone for the structure list; `#btn-cancel` (card corner) returns to the dropzone, asking for confirmation only when isolations would be lost.
   - **Isolar a parte de uma estrutura dentro de outra** (STL-only, 2+ files): each structure row carries an `Isolar parte` button that opens a menu of the other structures. Picking one splits that row into two under a rail — `B fora de A` (keeps the origin's identity) and `B dentro de A` (the isolated piece, a lighter tone of B's color). The original row stops existing: it *became* the two pieces, which is exactly what the viewer will show. The reference is an editable token inside the isolated piece's name; `Desfazer` removes that one operation.
   - **Grouping is by ORIGIN structure, not by operation.** Isolating an already-split leftover adds a row to the same group instead of nesting a second rail, so depth never exceeds one however many times you chain. Names compose in the order the backend applies them (`Tumor fora de Rim dentro de Coluna`).
   - **What the backend allows constrains the UI**: `processor._apply_boolean_ops` indexes by ORIGINAL structure name, so the isolated piece can be neither a target nor a reference — it has no entry in that index. Only original structures (and their renamed leftovers, the same mesh) offer `Isolar parte` or appear in the reference menu, and a reference already used for a target is not offered again.
   - **The reference menu only offers structures that overlap the target.** As soon as files are chosen, `upload/overlap-worker.js` (module Worker, so a 60 MB case never freezes the page) parses each STL (`upload/stl.js`, pure: binary + ASCII, vertices welded by exact position like trimesh) and tests every pair: disjoint bounding boxes → no overlap for free; otherwise a solid intersection in Manifold (`manifold-3d@3.5.3` from unpkg — same version as `/case/`'s importmap, and the same engine the backend uses), non-empty with volume > 0. That is exactly the condition `_apply_boolean_ops` enforces, so the screen never offers a pair the backend will refuse. A structure that overlaps nothing loses its `Isolar parte` button. Results stream in: while pending the menu lists what's confirmed plus "Procurando estruturas que se sobrepõem…", and `#structure-list[data-overlaps]` is `pending`/`done` (tests wait on it). Anything that can't be decided (open mesh, unreadable file, Manifold failed to load) stays offered — the backend then decides, as before. Chained targets (`Tumor fora de Rim`) reuse the ORIGINAL file's overlaps — an approximation; the backend still checks the real leftover.
   - **Colors**: this screen knows no mesh color — they come from `COLORS_BY_KEYWORD` in `mesh-processor`, and the isolated piece is a lighter tone of its origin's color (`processor._isolated_piece_material`). Every row gets a neutral bar rather than risk showing a color the model will not have; the isolated row's bar is the neutral one lightened, mirroring what the model does with the real color. The diagram (`#tpl-diagram`) draws the same idea in grays.
   - The pairs travel in the optional `boolean_ops` form field as JSON `[{"principal": "<filename>", "secondary": "<filename>"}]` (original filenames; the field/key names are frozen API contract, not UI wording) — old backends ignore the field. Never call this "booleana" in user-facing text, and never "dividir por": radiologists think anatomy, and "dividir X por Y" reads as arithmetic in pt-BR.
2. Poll `GET /status/{uid}` every 3s until `ready: true`; only then present the viewer URL to the clinician.

The backend URL is auto-detected from `window.location.hostname`: `localhost`/`127.0.0.1` → `http://localhost:8000` (dev), anything else → the Railway production URL. One constant at the top of `upload.js`; changing hosts is a one-line edit. Client-side file-size cap is 60MB total (mirrors the server). Error messages are rendered as-is from the backend's `detail` field — the backend writes them in Portuguese for the clinician.

### Dependencies (CDN-loaded)

- Three.js 0.164.0 (unpkg) - the `/case/` viewer; addons via the `three/addons/` importmap entry
- n8ao 1.9.4 (esm.sh, `?external=three`) - screen-space ambient occlusion pass
- Polyhaven `studio_small_09_1k.hdr` - studio IBL fetched at runtime from `dl.polyhaven.org` (RoomEnvironment fallback if it fails)
- Sketchfab Viewer API 1.9.0 - legacy `/case/legacy/` viewer only
- Tailwind CSS (landing page only — `/case/` and `/upload/` use `app.css`)
- Google Fonts (Plus Jakarta Sans, Inter, JetBrains Mono — imported by `colors_and_type.css`; Nunito Sans / Open Sans on the landing page)
- Google Tag Manager / Google Ads conversion tracking

## Code Patterns

- Vanilla JavaScript with direct DOM manipulation
- Each feature is isolated in its own JS file
- Global `api` variable for Sketchfab access
- Mobile/tablet detection via user agent sniffing
- SVG overlays for measurement visualization (fixed positioning)
