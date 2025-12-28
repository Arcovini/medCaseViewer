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

### Key Technical Details

**Sketchfab Integration**: The app uses Sketchfab Viewer API v1.9.0. The API instance is stored globally as `api` after initialization in `main.js`. All 3D interactions (materials, visibility, annotations) go through this API.

**URL Parameters**:
- `?id=MODEL_UID` - Load specific Sketchfab model
- `?autospin=VALUE` - Auto-rotation speed (0.0 disables)
- `?yt=VIDEO_ID` - Embed YouTube video with modal toggle

**Theme System**: `mudaCor.js` handles dark/light mode by modifying multiple DOM elements and recalculating text luminance for readability.

**Measurement Tool**: Uses `getWorldToScreenCoordinates` from Sketchfab API to project 3D points to 2D, then draws SVG lines. Measurements auto-clear on camera movement.

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
