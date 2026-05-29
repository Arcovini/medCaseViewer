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
- `/case/` - The 3D viewer application (native Three.js r0.164)
  - `index.html` - Viewer template: Three.js `<canvas>` + importmap (three, addons, n8ao)
  - `main.js` - Bootstrap: reads `?id`, loads the GLB, wires the measurement FAB, structures panel, theme toggle, share/AR
  - `world.js` - Three.js scene: renderer, lighting + IBL, tone mapping, N8AO, OrbitControls, outline pass (see Rendering pipeline)
  - `loader.js` - GLB fetch from Cloudflare R2 (`cases/{uid}.glb`), with a Sketchfab probe → `legacy/` fallback
  - `dom.js` - DOM helpers: structures panel, loading/error overlays, measurement FAB + hint banner
  - `measurement.js` / `volume.js` / `calibre.js` / `calibre-geom.js` - the three measurement modes (see Measurement Modes)
  - `ar.js` - "Ver em AR" handoff (model-viewer)
  - `legacy/` - the old Sketchfab-iframe viewer (`main.js`, `measure.js`, `opacity.js`, `mudaCor.js`, `laudo.js`, `mainLinhaLaudo.js`, `botao_video.js`), served as a fallback for cases that exist only on Sketchfab
- `/upload/` - Clinician self-service upload page (talks to the `mesh-processor` backend)
  - `index.html` - Multi-file STL input, 4-state UI (idle / processing / done / error) with Tailwind CDN
  - `upload.js` - Posts files to `POST /upload`, then polls `GET /status/{uid}` until ready

### Key Technical Details

**URL Parameters**:
- `?id=UID` - Load a case by UID. `loader.js` fetches `cases/{uid}.glb` from Cloudflare R2; on a 404 it probes the Sketchfab API and, if found, redirects to the `legacy/` Sketchfab viewer.

**Theme System (`/case/`)**: `main.js` (`initTheme`/`setTheme`/`toggleTheme`) toggles `html[data-theme]` — **dark by default**, persisted in `localStorage` under `medcase-viewer-theme`. CSS variables (`--w-*`, in `style.css`) flip per theme; `setTheme` also reads `--w-canvas-bg` and pushes it into the Three.js `scene.background` so the WebGL clear color tracks the CSS.

**Legacy Sketchfab viewer (`/case/legacy/`)**: the pre-Three.js viewer. Uses Sketchfab Viewer API v1.9.0 (global `api`), `mudaCor.js` for theming, and an SVG-overlay measurement tool via `getWorldToScreenCoordinates`. Supports `?autospin=` and `?yt=` params. Reached only via the R2-miss → Sketchfab fallback above.

**Rendering pipeline (`/case/world.js`)**: image formation tuned for product/medical realism:
- **Tone mapping**: `NeutralToneMapping` at `toneMappingExposure = 0.85` — faithful colors with a soft highlight rolloff (avoids ACESFilmic's cinematic desaturation and pure-white clipping).
- **Image-based lighting**: a Polyhaven `studio_small_09_1k.hdr` (~1.6MB) is fetched at runtime from `dl.polyhaven.org`, PMREM-prefiltered into `scene.environment` (`environmentIntensity = 2.0`); its softboxes read as crisp studio highlights. A synthetic `RoomEnvironment` lights the first frames and stays as a graceful fallback if the HDR fetch fails. The HDR lights the scene only — it is never shown as a skybox.
- **Light rig**: `HemisphereLight` + key + fill `DirectionalLight`s at moderate intensity — adds subtle direction and guarantees the magnifier's second `WebGLRenderer` (no shared PMREM env) is lit, without drowning the IBL or flattening the AO.
- **Ambient occlusion**: `N8AOPass` (pmndrs/n8ao, screen-space) in the `EffectComposer` — softer/faster than the native SSAOPass; supplies the contact shadows that give concavities depth. `aoRadius`/`distanceFalloff` are rescaled to the model's bounding radius in `frameToScene()`.
- **Background**: a flat `scene.background` kept in sync with the CSS `--w-canvas-bg` token via `setSceneBackground()` (light `#EDEFF2` / dark `#181818`), plus a soft radial vignette on `.vw-stage::before` (smoothstep falloff that eases out at the corners) for photographic depth.

**Measurement Modes (`/case/` Three.js viewer)**: three modes share a FAB pill + dropdown:
- **Linear** (`measurement.js`): 2-point Euclidean distance in mm, drawn as a Line2 with a label pill at the midpoint.
- **Volume** (`volume.js`): tap a mesh; computes real volume in cm³ via signed-tetrahedron sum over its triangles. Detects non-manifold meshes (open edges) and shows a `~` warn pill.
- **Calibre** (`calibre.js` + `calibre-geom.js`): tap one or two points on a vessel surface. Cast ray inward from P1 to find the opposite lumen wall → midpoint = local center C0. PCA over nearby vertices gives the centerline tangent. Iterative marching cuts cross-section polygons perpendicular to the tangent and recenters on each polygon's centroid, until the mesh boundary is reached, a bifurcation is detected (area > 4× previous), or P2 is reached. The centerline is rendered as a glowing inner Line2 (`depthTest:false`). Clicking on the centerline drops a circle perpendicular to the local tangent with diameter = `2·√(area/π)` (equivalent-circle diameter — clinical standard). Drag-along-centerline re-runs `diameterAt` on every pointermove. Multi-vessel meshes are handled by picking the polygon whose centroid is closest to the last centerline point.

**Future work — vessel centerline service**: the current calibre centerline extraction is a local marching algorithm in JS. It works well for straight/curved single vessels but can fail on branched topology. A more robust approach would be a Python service (similar to `mesh-processor` on Railway) running VTK or skimage skeletonization to precompute centerlines per mesh during upload. The viewer would then download the centerline polylines alongside the GLB and the calibre mode would be reduced to "click on the precomputed centerline → measure", removing the marching algorithm entirely.

**Upload flow (`/upload/`)**: Two-phase to accommodate Sketchfab's async server-side processing:
1. `POST /upload` with a `FormData` containing each STL under the repeated field name `files` (not `files[]`). Response is immediate and contains `{uid, viewer_url, ...}`.
2. Poll `GET /status/{uid}` every 3s until `ready: true`; only then present the viewer URL to the clinician.

The backend URL is auto-detected from `window.location.hostname`: `localhost`/`127.0.0.1` → `http://localhost:8000` (dev), anything else → the Railway production URL. One constant at the top of `upload.js`; changing hosts is a one-line edit. Client-side file-size cap is 60MB total (mirrors the server). Error messages are rendered as-is from the backend's `detail` field — the backend writes them in Portuguese for the clinician.

### Dependencies (CDN-loaded)

- Three.js 0.164.0 (unpkg) - the `/case/` viewer; addons via the `three/addons/` importmap entry
- n8ao 1.9.4 (esm.sh, `?external=three`) - screen-space ambient occlusion pass
- Polyhaven `studio_small_09_1k.hdr` - studio IBL fetched at runtime from `dl.polyhaven.org` (RoomEnvironment fallback if it fails)
- Sketchfab Viewer API 1.9.0 - legacy `/case/legacy/` viewer only
- Tailwind CSS (landing page only)
- Google Fonts (Nunito Sans, Open Sans)
- Google Tag Manager / Google Ads conversion tracking

## Code Patterns

- Vanilla JavaScript with direct DOM manipulation
- Each feature is isolated in its own JS file
- Global `api` variable for Sketchfab access
- Mobile/tablet detection via user agent sniffing
- SVG overlays for measurement visualization (fixed positioning)
