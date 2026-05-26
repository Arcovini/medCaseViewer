// case/world.js
// Tudo dentro do canvas (Three.js). Não toca em DOM além do canvas que recebe.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { pickNearestSegment } from "./calibre-geom.js";

let renderer, scene, camera, controls;
let css2dRenderer;
let composer;            // EffectComposer pra outline pass
let outlinePass;         // OutlinePass — desenha contorno reliable em malhas selecionadas
let pmremGenerator;
const namedMeshes = new Map();
const lastOpacity = new Map();   // name -> último valor não-zero (default fallback é 1.0)
const lineMaterials = new Set(); // pra atualizar resolution no resize (Line2 precisa disso)
let mountedRoot = null;
let _initialCameraDistance = null;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Tracking de objetos visuais da medição (endpoints, candidates, lines, pills).
// Mapa de id (autoincremental) → { type, object3D, ... }.
const measurementObjects = new Map();
let nextMeasurementId = 1;

const COLOR_ACCENT = 0xC8412C;       // usado só no OutlinePass (highlight da malha)
// Amarelo de alto contraste pras geometrias de medição (linhas, pontos,
// círculos). Vence vermelho (artéria), azul (veia) e verde (tumor) — não
// se confunde com nenhuma cor anatômica padrão.
const COLOR_MEASURE = 0xFFEB00;

// Estado da lupa (segundo WebGLRenderer em canvas dedicado).
let loupeRenderer = null;
let loupeCamera = null;
let loupeTarget = null;
let loupeOpen = false;
const LOUPE_ZOOM = 3.0;

export function init(canvasEl) {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Canvas size comes from its CSS layout (parent .vw-stage in the new shell, or
  // the full viewport when canvas is body-level). Fall back to window size if the
  // rect is zero (e.g., parent not laid out yet on very early frames).
  const _r0 = canvasEl.getBoundingClientRect();
  const _w0 = _r0.width || window.innerWidth;
  const _h0 = _r0.height || window.innerHeight;
  renderer.setSize(_w0, _h0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  // Opaque background — required for the transparent-mesh fix
  // (commit d20a0cd: depthWrite condicional ao opacity). With alpha:true
  // the renderer composites against a zero-alpha clear color which
  // breaks blending order on overlapping translucent meshes. Theme
  // changes are handled via setSceneBackground() below; main.js wires it
  // to the CSS var --w-canvas-bg whenever the theme flips.
  scene.background = new THREE.Color(0xEDEFF2);

  pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  // Luzes explícitas como fallback. A IBL via PMREMGenerator é gerada
  // pelo renderer principal e não compartilha bem entre WebGLRenderers
  // (lupa usa um segundo renderer). Estas luzes garantem que ambos os
  // contextos vejam a cena iluminada de forma consistente.
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7);
  scene.add(ambientLight);
  scene.add(dirLight);

  camera = new THREE.PerspectiveCamera(45, _w0 / _h0, 0.1, 1000);
  camera.position.set(0, 0, 3);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // CSS2DRenderer: HTML overlay alinhado a coordenadas 3D (usado pela pílula da medição).
  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(_w0, _h0);
  css2dRenderer.domElement.style.position = "absolute";
  css2dRenderer.domElement.style.top = "0";
  css2dRenderer.domElement.style.left = "0";
  css2dRenderer.domElement.style.pointerEvents = "none";   // taps caem no canvas
  canvasEl.parentElement.appendChild(css2dRenderer.domElement);

  // EffectComposer + OutlinePass: desenha contorno cyan consistente nas malhas
  // selecionadas via setMeshHighlight. Substituiu o inverted-hull (que ficava
  // deslocado em geometrias com vértices fora do origem local).
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  outlinePass = new OutlinePass(
    new THREE.Vector2(_w0, _h0),
    scene,
    camera,
  );
  outlinePass.edgeStrength = 6;
  outlinePass.edgeGlow = 0.3;
  outlinePass.edgeThickness = 2;
  outlinePass.pulsePeriod = 0;       // sem pulse (já temos pulse no candidato)
  outlinePass.visibleEdgeColor.setHex(COLOR_ACCENT);
  outlinePass.hiddenEdgeColor.setHex(COLOR_ACCENT);
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());

  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(tick);
}

function onResize() {
  const rect = renderer.domElement.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || window.innerHeight;
  renderer.setSize(w, h, false);
  css2dRenderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (outlinePass) outlinePass.setSize(w, h);
  // Line2/LineMaterial precisa da resolution pra calcular linewidth em pixels.
  for (const mat of lineMaterials) mat.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function tick() {
  controls.update();
  // Billboard + pulse: candidate sempre olha a câmera e tem respiração
  // (0.88 → 1.12, ciclo ~1.5s) pra sinalizar afordância de drag.
  const pulseScale = 1 + 0.12 * Math.sin(performance.now() * 0.004);
  for (const entry of measurementObjects.values()) {
    if (entry.type === "candidate") {
      entry.object3D.quaternion.copy(camera.quaternion);
      entry.object3D.scale.set(pulseScale, pulseScale, pulseScale);
    }
  }
  composer.render();   // substitui renderer.render(scene, camera) — inclui OutlinePass
  css2dRenderer.render(scene, camera);

  if (loupeOpen && loupeRenderer && loupeTarget) {
    loupeCamera.position.copy(camera.position);
    loupeCamera.up.copy(camera.up);
    loupeCamera.lookAt(loupeTarget);
    loupeCamera.fov = camera.fov / LOUPE_ZOOM;
    loupeCamera.updateProjectionMatrix();
    loupeRenderer.render(scene, loupeCamera);
  }
}

export function mount(rootObject) {
  if (mountedRoot) {
    scene.remove(mountedRoot);
  }
  mountedRoot = rootObject;
  scene.add(rootObject);

  namedMeshes.clear();
  lastOpacity.clear();
  rootObject.traverse((child) => {
    if (child.isMesh && child.name) {
      // Clone material per-mesh so opacity changes on one mesh cannot
      // bleed into sibling meshes that share the same material in the GLB.
      child.material = child.material.clone();
      // Permanent `transparent: true` evita o flip discreto da flag em 1.0/0.99.
      // `depthWrite` é dinâmico (ver setOpacity): true em opacity=1 pra mesh
      // opaca ocluir corretamente; false em opacity<1 pra não bloquear malhas
      // interpenetrantes atrás (vasos dentro de um rim translúcido, p.ex).
      child.material.transparent = true;
      child.material.depthWrite = true;
      namedMeshes.set(child.name, child);
    }
  });
}

export function setVisibility(name, visible) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return;
  if (visible) {
    const restored = lastOpacity.get(name) ?? 1;
    mesh.material.opacity = restored;
    mesh.material.depthWrite = restored >= 1;
    mesh.visible = true;
  } else {
    // Only hide the mesh; do not touch material.opacity — the slider
    // should keep displaying the value the user last set.
    mesh.visible = false;
  }
}

export function frameToScene() {
  if (!mountedRoot) return;

  const box = new THREE.Box3().setFromObject(mountedRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5;

  camera.position.set(center.x, center.y, center.z + radius * 2.2);
  camera.near = Math.max(radius * 0.01, 0.001);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();

  _initialCameraDistance = camera.position.distanceTo(controls.target);
}

export function setOpacity(name, value) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return;
  mesh.material.opacity = value;
  mesh.material.depthWrite = value >= 1;
  mesh.visible = value > 0;
  if (value > 0) lastOpacity.set(name, value);   // só lembra valor não-zero
}

export function getMeshOpacity(name) {
  const mesh = namedMeshes.get(name);
  return mesh ? (mesh.material.opacity ?? null) : null;
}

export function getMeshColor(name) {
  const mesh = namedMeshes.get(name);
  if (!mesh || !mesh.material.color) return null;
  // Textured meshes (PBR baseColorTexture / MeshStandardMaterial.map) carry
  // their look in the texture; the material.color factor is white (1,1,1) by
  // default and exposing it as the swatch would mislead the panel into showing
  // a generic white chip for a photo-realistic mesh. Returning null lets dom.js
  // skip the --struct-color override and fall through to neutral chrome.
  if (mesh.material.map) return null;
  return "#" + mesh.material.color.getHexString();
}

export function getMeshNames() {
  return Array.from(namedMeshes.keys());
}

// Retorna a raiz do GLB atualmente montado (Three.js Object3D) ou null
// se nenhum modelo foi montado ainda. Usado pelo módulo `ar.js` para passar
// a cena ao USDZExporter.
export function getMountedRoot() {
  return mountedRoot;
}

export function getMeshVisibility(name) {
  const mesh = namedMeshes.get(name);
  return mesh ? mesh.visible : null;
}

// ===========================================================================
// Sprint 3b.2 — Medição linear
// ===========================================================================

// Pega o ponto 3D mais próximo da câmera entre as malhas com `visible === true`.
// (x, y) são pixel-coords do canvas (não NDC). Retorna null em caso de miss.
export function raycastFromScreen(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const candidates = [];
  for (const mesh of namedMeshes.values()) {
    if (mesh.visible) candidates.push(mesh);
  }
  const hits = raycaster.intersectObjects(candidates, false);
  if (hits.length === 0) return null;

  const h = hits[0];
  return {
    meshName: h.object.name,
    point3D: h.point.clone(),
    faceIndex: h.faceIndex,
  };
}

// Projeta um Vector3 da cena para coordenadas de pixel da viewport.
// Útil pra detectar "clique caiu sobre o handle 3D do candidato".
export function projectToScreen(point3D) {
  const v = point3D.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + (v.x + 1) * 0.5 * rect.width,
    y: rect.top + (-v.y + 1) * 0.5 * rect.height,
  };
}

export function setControlsEnabled(enabled) {
  controls.enabled = enabled;
}

export function onCameraChange(callback) {
  controls.addEventListener("change", callback);
}

// --- Endpoint (ponto sólido confirmado + label P1/P2) ---
// Sphere ~3mm de diâmetro, cyan, sempre visível (depthTest:false).
// Label opcional ("P1"/"P2") via CSS2DObject — texto persistente, lido em
// qualquer zoom/orientação, garante que o clínico não perde a referência
// do ponto após confirmar.

export function addEndpoint(point3D, label) {
  const id = nextMeasurementId++;
  const geom = new THREE.SphereGeometry(1.5, 24, 24);
  const mat = new THREE.MeshBasicMaterial({ color: COLOR_MEASURE, depthTest: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(point3D);
  mesh.renderOrder = 999;
  scene.add(mesh);

  let labelObj = null;
  let labelEl = null;
  if (label) {
    labelEl = document.createElement("div");
    labelEl.className = "measurement-endpoint-label";
    labelEl.textContent = label;
    labelObj = new CSS2DObject(labelEl);
    labelObj.position.copy(point3D);
    scene.add(labelObj);
  }

  measurementObjects.set(id, { type: "endpoint", object3D: mesh, labelObj, labelEl });
  return id;
}

export function removeEndpoint(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "endpoint") return;
  scene.remove(entry.object3D);
  entry.object3D.geometry.dispose();
  entry.object3D.material.dispose();
  if (entry.labelObj) {
    scene.remove(entry.labelObj);
    if (entry.labelEl?.parentElement) entry.labelEl.parentElement.removeChild(entry.labelEl);
  }
  measurementObjects.delete(id);
}

// --- Candidate (ghost point dashed, refinável) ---
// Tamanho 2.5 ≈ 5mm de diâmetro, visível como handle arrastável.
// Acrescenta um dot branco central pra reforçar leitura de "alvo".
// Antes era radius 0.7 (~1mm) — invisível em renais.

export function addCandidate(point3D) {
  const id = nextMeasurementId++;
  const radius = 3.5;
  const segments = 64;

  // Anel tracejado externo. Antes usava THREE.Line + LineDashedMaterial
  // com `linewidth: 2` — mas no WebGL Line sempre renderiza 1px (limitação
  // conhecida do GL). Line2 + LineMaterial honra linewidth em pixels via
  // expansão geometry-shader-style.
  const ringPositions = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ringPositions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  }
  const ringGeom = new LineGeometry();
  ringGeom.setPositions(ringPositions);
  const ringMat = new LineMaterial({
    color: COLOR_MEASURE,
    linewidth: 4,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    dashed: true,
    dashSize: 6,
    gapSize: 4,
    dashScale: 1,
  });
  const _r = renderer.domElement.getBoundingClientRect();
  ringMat.resolution.set(_r.width || window.innerWidth, _r.height || window.innerHeight);
  lineMaterials.add(ringMat);
  const ring = new Line2(ringGeom, ringMat);
  ring.computeLineDistances();

  // Dot branco central (afordância de "centro do alvo / agarrável")
  const dotGeom = new THREE.CircleGeometry(1.2, 24);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const dot = new THREE.Mesh(dotGeom, dotMat);

  // Group billboard que segue a câmera (rotaciona junto no tick)
  const group = new THREE.Group();
  group.add(ring);
  group.add(dot);
  group.position.copy(point3D);
  group.renderOrder = 999;
  ring.renderOrder = 999;
  dot.renderOrder = 1000;

  scene.add(group);
  measurementObjects.set(id, { type: "candidate", object3D: group, ringMat });
  return id;
}

export function moveCandidate(id, point3D) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "candidate") return;
  entry.object3D.position.copy(point3D);
}

export function removeCandidate(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "candidate") return;
  scene.remove(entry.object3D);
  // Candidato é um Group (anel Line2 + dot Mesh). O ringMat (Line2) também
  // precisa sair do lineMaterials set (atualizado no resize).
  if (entry.ringMat) lineMaterials.delete(entry.ringMat);
  entry.object3D.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
  measurementObjects.delete(id);
}

// --- Line (Line2 com linewidth real em pixels) ---
// THREE.Line + LineBasicMaterial não respeita linewidth > 1 em WebGL —
// linha ficava sempre 1px e às vezes invisível atrás de estruturas.
// Line2/LineMaterial renderizam linha como tira de quad (geometry shader-style)
// com linewidth em pixels honrado em todas as plataformas.

const LINE_WIDTH_PX = 4;
const LINE_DASH_SIZE = 6;       // em pixels (cyan + transparent alternados)
const LINE_GAP_SIZE = 4;

function _makeLineMaterial(provisional) {
  const mat = new LineMaterial({
    color: COLOR_MEASURE,
    linewidth: LINE_WIDTH_PX,
    transparent: true,
    depthTest: false,           // linha sempre na frente das estruturas
    dashed: !!provisional,
    dashSize: LINE_DASH_SIZE,
    gapSize: LINE_GAP_SIZE,
    dashScale: 1,
  });
  const _r = renderer.domElement.getBoundingClientRect();
  mat.resolution.set(_r.width || window.innerWidth, _r.height || window.innerHeight);
  lineMaterials.add(mat);
  return mat;
}

export function addLine(p1, p2, { provisional }) {
  const id = nextMeasurementId++;
  const geom = new LineGeometry();
  geom.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
  const mat = _makeLineMaterial(provisional);
  const line = new Line2(geom, mat);
  line.computeLineDistances();
  line.renderOrder = 998;
  scene.add(line);
  // Guarda p1 no entry pra que updateLineEnd possa rescrever a geometria
  // sem precisar ler de attributes.instanceStart (formato interno do Line2).
  measurementObjects.set(id, {
    type: "line",
    object3D: line,
    provisional,
    p1: p1.clone(),
  });
  return id;
}

export function updateLineEnd(id, p2) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "line") return;
  const { p1 } = entry;
  entry.object3D.geometry.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
  entry.object3D.computeLineDistances();
}

export function updateLineProvisional(id, isProvisional) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "line") return;
  if (entry.provisional === isProvisional) return;
  const line = entry.object3D;
  line.material.dashed = isProvisional;
  line.material.needsUpdate = true;
  entry.provisional = isProvisional;
}

export function removeLine(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "line") return;
  scene.remove(entry.object3D);
  entry.object3D.geometry.dispose();
  lineMaterials.delete(entry.object3D.material);
  entry.object3D.material.dispose();
  measurementObjects.delete(id);
}

// --- Pill (CSS2DObject com texto da distância) ---

export function addPill(midpoint3D, text, { warn } = {}) {
  const id = nextMeasurementId++;
  const el = document.createElement("div");
  el.className = "measurement-pill";
  el.textContent = text;
  if (warn) el.dataset.warn = "true";
  const obj = new CSS2DObject(el);
  obj.position.copy(midpoint3D);
  scene.add(obj);
  measurementObjects.set(id, { type: "pill", object3D: obj, el });
  return id;
}

export function updatePill(id, midpoint3D, text) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "pill") return;
  entry.object3D.position.copy(midpoint3D);
  if (text !== undefined) entry.el.textContent = text;
}

export function updatePillOffset(id, offsetPx) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "pill") return;
  entry.el.style.transform = `translate(-50%, calc(-50% - ${offsetPx}px))`;
}

export function removePill(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "pill") return;
  scene.remove(entry.object3D);
  if (entry.el.parentElement) entry.el.parentElement.removeChild(entry.el);
  measurementObjects.delete(id);
}

// --- Mesh highlight via OutlinePass (postprocessing) ---
// Substituiu o inverted-hull. OutlinePass usa um buffer separado pra detectar
// silhueta da malha selecionada e desenha contorno cyan consistente em
// pixels — independe de geometria estar centrada no origem local, escala
// não-uniforme, ou qualquer transform peculiar do GLB.

export function setMeshHighlight(meshName, on) {
  const mesh = namedMeshes.get(meshName);
  if (!mesh || !outlinePass) return;
  if (on) {
    // Mantém só a malha atualmente destacada — substitui qualquer anterior.
    outlinePass.selectedObjects = [mesh];
  } else {
    // Só limpa se ainda for essa a malha selecionada (evita race condition
    // quando o highlight do candidato muda rapidamente entre malhas).
    if (outlinePass.selectedObjects[0] === mesh) {
      outlinePass.selectedObjects = [];
    }
  }
}

// --- Lupa (segundo WebGLRenderer em canvas dedicado) ---

export function attachLoupeCanvas(canvasEl) {
  if (loupeRenderer) return;     // já anexado
  loupeRenderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
  });
  loupeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // canvasEl.clientWidth retorna 0 quando o wrapper está com display:none
  // na hora do attach. Usar canvasEl.width (atributo HTML, default 100)
  // que independe do estado de display.
  loupeRenderer.setSize(canvasEl.width, canvasEl.height, false);
  loupeRenderer.outputColorSpace = THREE.SRGBColorSpace;
  loupeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  loupeRenderer.toneMappingExposure = 1.0;

  loupeCamera = new THREE.PerspectiveCamera(
    camera.fov / LOUPE_ZOOM,
    1,
    camera.near,
    camera.far,
  );
}

export function openLoupe({ point3D }) {
  if (!loupeRenderer) return;
  if (!loupeTarget) loupeTarget = point3D.clone();
  else loupeTarget.copy(point3D);
  loupeOpen = true;
}

export function updateLoupe({ point3D }) {
  if (!loupeOpen || !loupeTarget) return;
  loupeTarget.copy(point3D);
}

export function closeLoupe() {
  loupeOpen = false;
}

// --- Measurement visibility (esconde/restaura linha+endpoints+pílula) ---

export function setMeasurementVisibility(ids, visible) {
  for (const id of ids) {
    const entry = measurementObjects.get(id);
    if (!entry) continue;
    entry.object3D.visible = visible;
    if (entry.labelObj) entry.labelObj.visible = visible;
  }
}

// --- Zoom helpers (used by the floating zoom chip in case-next/index.html) ---
// zoomBy(factor): dolly the camera by a multiplicative factor toward (factor>1)
// or away from (factor<1) the orbit target. factor=1.2 ≈ dollyIn equivalent.

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

// ===========================================================================
// Sprint 3b.3 — Medição de volume
// ===========================================================================

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

// Calcula volume real de uma malha em cm³ via soma de tetraedros sinalizados
// sobre os triângulos. Vértices em coordenadas de mundo via mesh.matrixWorld
// pra que escala/rotação do GLB sejam respeitadas. No mesmo loop, conta
// referências de cada aresta: em malha fechada cada aresta é compartilhada
// por exatamente 2 triângulos. Caso contrário, manifold=false e a UI mostra
// soft warning (~12,3 cm³).
export function computeMeshVolumeForMesh(mesh) {
  mesh.updateMatrixWorld();
  const matrix = mesh.matrixWorld;
  const positions = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;

  const triCount = index ? index.count / 3 : positions.count / 3;
  let signedVolume = 0;
  const edgeCounts = new Map();

  function bumpEdge(a, b) {
    const k = a < b ? (a * 0x200000 + b) : (b * 0x200000 + a);
    edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3)     : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _v0.fromBufferAttribute(positions, i0).applyMatrix4(matrix);
    _v1.fromBufferAttribute(positions, i1).applyMatrix4(matrix);
    _v2.fromBufferAttribute(positions, i2).applyMatrix4(matrix);

    _cross.crossVectors(_v1, _v2);
    signedVolume += _v0.dot(_cross);

    bumpEdge(i0, i1);
    bumpEdge(i1, i2);
    bumpEdge(i2, i0);
  }

  let manifold = true;
  for (const c of edgeCounts.values()) {
    if (c !== 2) { manifold = false; break; }
  }

  const volumeMm3 = Math.abs(signedVolume) / 6;
  return {
    volumeCm3: volumeMm3 / 1000,
    manifold,
  };
}

const _volumeCache = new Map();   // name → { volumeCm3, manifold }

export function computeMeshVolumeCached(name) {
  if (_volumeCache.has(name)) return _volumeCache.get(name);
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const result = computeMeshVolumeForMesh(mesh);
  _volumeCache.set(name, result);
  return result;
}

export function getMeshCentroid(name) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  return box.getCenter(new THREE.Vector3());
}

// Hook de teste: injeta valor no cache de volume sem precisar computar.
// Usado pra cobrir caminhos non-manifold sem depender da topologia exata
// das malhas do fixture. ES module bindings são imutáveis, então
// monkey-patch externo não funcionaria.
export function __testInjectVolumeCache(name, value) {
  _volumeCache.set(name, value);
}

// ===========================================================================
// Sprint 3b.4 — Medição de calibre (vessel diameter)
// ===========================================================================

// Triangle soup cacheado por mesh: positions já transformadas pra world-space.
// Espelha _volumeCache (acima): pague o custo da transformação UMA vez por mesh.
const _triangleSoupCache = new Map();

export function getMeshTriangleSoup(name) {
  if (_triangleSoupCache.has(name)) return _triangleSoupCache.get(name);
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  mesh.updateMatrixWorld();
  const geom = mesh.geometry;
  const localPos = geom.attributes.position;
  const indexAttr = geom.index;

  const worldPositions = new Float32Array(localPos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < localPos.count; i++) {
    v.fromBufferAttribute(localPos, i).applyMatrix4(mesh.matrixWorld);
    worldPositions[i * 3]     = v.x;
    worldPositions[i * 3 + 1] = v.y;
    worldPositions[i * 3 + 2] = v.z;
  }

  let worldIndices = null;
  if (indexAttr) {
    worldIndices = new Uint32Array(indexAttr.count);
    for (let i = 0; i < indexAttr.count; i++) {
      worldIndices[i] = indexAttr.getX(i);
    }
  }

  const soup = { positions: worldPositions, indices: worldIndices };
  _triangleSoupCache.set(name, soup);
  return soup;
}

// Normal da face em world-space. Computa cross product de duas arestas do
// triângulo já transformado. Sinal segue winding order do mesh — para malhas
// orientadas pra fora, retorna o normal "pra fora" do lume.
export function getMeshFaceNormalWorld(name, faceIndex) {
  const soup = getMeshTriangleSoup(name);
  if (!soup) return null;
  const { positions, indices } = soup;
  let i0, i1, i2;
  if (indices) {
    i0 = indices[faceIndex * 3] * 3;
    i1 = indices[faceIndex * 3 + 1] * 3;
    i2 = indices[faceIndex * 3 + 2] * 3;
  } else {
    i0 = faceIndex * 9;
    i1 = faceIndex * 9 + 3;
    i2 = faceIndex * 9 + 6;
  }
  const v0 = new THREE.Vector3(positions[i0],     positions[i0 + 1], positions[i0 + 2]);
  const v1 = new THREE.Vector3(positions[i1],     positions[i1 + 1], positions[i1 + 2]);
  const v2 = new THREE.Vector3(positions[i2],     positions[i2 + 1], positions[i2 + 2]);
  const e1 = v1.sub(v0);
  const e2 = v2.sub(v0);
  return e1.cross(e2).normalize();
}

// Raycast contra um único mesh, usando o triangle soup world-space que já
// temos cacheado. Bypass do THREE.Raycaster.intersectObject pra evitar
// edge cases envolvendo matrixWorld stale ou BoundingSphere desatualizada
// — vimos casos onde intersectObject retornava 0 hits mesmo com o ray
// claramente cortando o mesh. Möller-Trumbore é O(N) por chamada mas
// aceitável (50k tris × 6 cross-products ≈ 1-2 ms).
const RAY_OFFSET_EPSILON = 0.001;
const RAY_T_EPSILON = 1e-4;

export function raycastInternal(meshName, origin, direction) {
  const soup = getMeshTriangleSoup(meshName);
  if (!soup) return null;
  const dir = direction.clone().normalize();
  const ox = origin.x + dir.x * RAY_OFFSET_EPSILON;
  const oy = origin.y + dir.y * RAY_OFFSET_EPSILON;
  const oz = origin.z + dir.z * RAY_OFFSET_EPSILON;

  const { positions, indices } = soup;
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  let bestT = Infinity;
  let bestPx = 0, bestPy = 0, bestPz = 0;

  const dx = dir.x, dy = dir.y, dz = dir.z;
  // Möller-Trumbore inline com scratch numéricos
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (indices) {
      i0 = indices[t * 3] * 3;
      i1 = indices[t * 3 + 1] * 3;
      i2 = indices[t * 3 + 2] * 3;
    } else {
      i0 = t * 9; i1 = t * 9 + 3; i2 = t * 9 + 6;
    }
    const v0x = positions[i0],     v0y = positions[i0 + 1], v0z = positions[i0 + 2];
    const v1x = positions[i1],     v1y = positions[i1 + 1], v1z = positions[i1 + 2];
    const v2x = positions[i2],     v2y = positions[i2 + 1], v2z = positions[i2 + 2];
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    // h = dir × e2
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -1e-10 && a < 1e-10) continue; // paralelo
    const f = 1 / a;
    const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    // q = s × e1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;
    const tt = f * (e2x * qx + e2y * qy + e2z * qz);
    if (tt > RAY_T_EPSILON && tt < bestT) {
      bestT = tt;
      bestPx = ox + tt * dx;
      bestPy = oy + tt * dy;
      bestPz = oz + tt * dz;
    }
  }

  if (!isFinite(bestT)) return null;
  return new THREE.Vector3(bestPx, bestPy, bestPz);
}

// Constrói base ortonormal {u, w} perpendicular a `tangent` (que é o eixo
// da centerline no ponto). Usado pra gerar os 64 vértices do círculo do
// diâmetro no plano perpendicular.
function _computeCirclePlaneBasis(tangent, u, w) {
  const t = tangent.clone().normalize();
  // Escolha ref que não seja paralelo a t pra evitar cross degenerado
  const ref = (Math.abs(t.x) < 0.9) ? _refX : _refY;
  u.crossVectors(t, ref).normalize();
  w.crossVectors(t, u).normalize();
}
const _refX = new THREE.Vector3(1, 0, 0);
const _refY = new THREE.Vector3(0, 1, 0);

const CIRCLE_SEGMENTS = 64;
const CIRCLE_LINEWIDTH_PX = 6;
const CENTERLINE_LINEWIDTH_PX = 6;

function _buildCirclePositions(center, tangent, radius) {
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  _computeCirclePlaneBasis(tangent, u, w);
  const out = new Array((CIRCLE_SEGMENTS + 1) * 3);
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    out[i * 3]     = center.x + radius * (cos * u.x + sin * w.x);
    out[i * 3 + 1] = center.y + radius * (cos * u.y + sin * w.y);
    out[i * 3 + 2] = center.z + radius * (cos * u.z + sin * w.z);
  }
  return out;
}

// --- Centerline (Line2 com depthTest:false; ID gerado, registrado em measurementObjects) ---

export function addCenterline(points3D, { dashed = false } = {}) {
  const id = nextMeasurementId++;
  const positions = [];
  for (const p of points3D) positions.push(p.x, p.y, p.z);
  const geom = new LineGeometry();
  geom.setPositions(positions);
  // Match settings de addLine() acima: transparent + depthTest:false +
  // depthWrite:false força a linha a aparecer mesmo dentro do vaso.
  const mat = new LineMaterial({
    color: COLOR_MEASURE,
    linewidth: CENTERLINE_LINEWIDTH_PX,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    dashed,
    dashSize: dashed ? 4 : 1,
    gapSize:  dashed ? 3 : 1,
    dashScale: 1,
  });
  const _r = renderer.domElement.getBoundingClientRect();
  mat.resolution.set(_r.width || window.innerWidth, _r.height || window.innerHeight);
  lineMaterials.add(mat);

  const line = new Line2(geom, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  scene.add(line);

  measurementObjects.set(id, {
    type: "centerline",
    object3D: line,
    points: points3D.map(p => p.clone()),
  });
  return id;
}

export function updateCenterline(id, points3D) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "centerline") return;
  const positions = [];
  for (const p of points3D) positions.push(p.x, p.y, p.z);
  entry.object3D.geometry.setPositions(positions);
  if (entry.object3D.material.dashed) entry.object3D.computeLineDistances();
  entry.points = points3D.map(p => p.clone());
}

export function removeCenterline(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "centerline") return;
  scene.remove(entry.object3D);
  entry.object3D.geometry.dispose();
  lineMaterials.delete(entry.object3D.material);
  entry.object3D.material.dispose();
  measurementObjects.delete(id);
}

export function getCenterlinePoints(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "centerline") return null;
  return entry.points.map(p => p.clone());
}

// Hit-test screen-space pra ponto na polyline. Mais robusto que Raycaster
// quando a centerline está parcialmente atrás de geometria translúcida.
export function pickPointOnCenterline(centerlineId, x, y, threshold = 22) {
  const entry = measurementObjects.get(centerlineId);
  if (!entry || entry.type !== "centerline") return null;
  const screenPts = entry.points.map(p => projectToScreen(p));
  const hit = pickNearestSegment(screenPts, x, y, threshold);
  if (!hit) return null;
  const p1 = entry.points[hit.segmentIndex];
  const p2 = entry.points[hit.segmentIndex + 1];
  const point3D = new THREE.Vector3().lerpVectors(p1, p2, hit.t);
  const tangent = new THREE.Vector3().subVectors(p2, p1).normalize();
  return { point3D, segmentIndex: hit.segmentIndex, t: hit.t, tangent };
}

// --- Diameter circle (Line2 fechado, perpendicular à tangente) ---

export function addDiameterCircle(center, tangent, radius) {
  const id = nextMeasurementId++;
  const positions = _buildCirclePositions(center, tangent, radius);
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const mat = new LineMaterial({
    color: COLOR_MEASURE,
    linewidth: CIRCLE_LINEWIDTH_PX,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    dashed: false,
  });
  const _r = renderer.domElement.getBoundingClientRect();
  mat.resolution.set(_r.width || window.innerWidth, _r.height || window.innerHeight);
  lineMaterials.add(mat);

  const line = new Line2(geom, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  scene.add(line);

  measurementObjects.set(id, {
    type: "diameter-circle",
    object3D: line,
    center: center.clone(),
    tangent: tangent.clone(),
    radius,
  });
  return id;
}

export function updateDiameterCircle(id, center, tangent, radius) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "diameter-circle") return;
  const positions = _buildCirclePositions(center, tangent, radius);
  entry.object3D.geometry.setPositions(positions);
  entry.center.copy(center);
  entry.tangent.copy(tangent);
  entry.radius = radius;
}

export function removeDiameterCircle(id) {
  const entry = measurementObjects.get(id);
  if (!entry || entry.type !== "diameter-circle") return;
  scene.remove(entry.object3D);
  entry.object3D.geometry.dispose();
  lineMaterials.delete(entry.object3D.material);
  entry.object3D.material.dispose();
  measurementObjects.delete(id);
}

// Updates the scene's clear-color background to the given hex string
// (e.g. "#EDEFF2", "#000000"). Main.js calls this when the theme flips
// — keeps Three.js opaque (so transparency blending stays correct) while
// still letting the 3D backdrop follow html[data-theme="dark"].
export function setSceneBackground(hex) {
  if (!scene || !hex) return;
  try {
    if (scene.background && scene.background.isColor) {
      scene.background.set(hex);
    } else {
      scene.background = new THREE.Color(hex);
    }
  } catch (_) {
    // invalid color string — leave previous bg alone.
  }
}
