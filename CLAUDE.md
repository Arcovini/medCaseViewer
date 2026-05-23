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
- `/case/` - The 3D viewer application
  - `index.html` - Viewer HTML template with Sketchfab iframe
  - `main.js` - Sketchfab API initialization, node tree management
  - `measure.js` - 3D click-to-measure tool with SVG overlay
  - `opacity.js` - Material opacity slider controls
  - `mudaCor.js` - Light/dark theme switching
  - `laudo.js` / `mainLinhaLaudo.js` - Report/documentation features
  - `botao_video.js` - YouTube video modal integration
- `/upload/` - Clinician self-service upload page (talks to the `mesh-processor` backend)
  - `index.html` - Multi-file STL input, 4-state UI (idle / processing / done / error) with Tailwind CDN
  - `upload.js` - Posts files to `POST /upload`, then polls `GET /status/{uid}` until ready

### Key Technical Details

**Sketchfab Integration**: The app uses Sketchfab Viewer API v1.9.0. The API instance is stored globally as `api` after initialization in `main.js`. All 3D interactions (materials, visibility, annotations) go through this API.

**URL Parameters**:
- `?id=MODEL_UID` - Load specific Sketchfab model
- `?autospin=VALUE` - Auto-rotation speed (0.0 disables)
- `?yt=VIDEO_ID` - Embed YouTube video with modal toggle

**Theme System**: `mudaCor.js` handles dark/light mode by modifying multiple DOM elements and recalculating text luminance for readability.

**Measurement Tool**: Uses `getWorldToScreenCoordinates` from Sketchfab API to project 3D points to 2D, then draws SVG lines. Measurements auto-clear on camera movement.

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

- Sketchfab Viewer API 1.9.0
- Tailwind CSS (landing page only)
- Google Fonts (Nunito Sans, Open Sans)
- Google Tag Manager / Google Ads conversion tracking

## Code Patterns

- Vanilla JavaScript with direct DOM manipulation
- Each feature is isolated in its own JS file
- Global `api` variable for Sketchfab access
- Mobile/tablet detection via user agent sniffing
- SVG overlays for measurement visualization (fixed positioning)
