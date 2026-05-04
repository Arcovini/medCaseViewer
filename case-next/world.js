// case-next/world.js
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

let renderer, scene, camera, controls;
let css2dRenderer;
let composer;            // EffectComposer pra outline pass
let outlinePass;         // OutlinePass — desenha contorno reliable em malhas selecionadas
let pmremGenerator;
const namedMeshes = new Map();
const lastOpacity = new Map();   // name -> último valor não-zero (default fallback é 1.0)
const lineMaterials = new Set(); // pra atualizar resolution no resize (Line2 precisa disso)
let mountedRoot = null;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Tracking de objetos visuais da medição (endpoints, candidates, lines, pills).
// Mapa de id (autoincremental) → { type, object3D, ... }.
const measurementObjects = new Map();
let nextMeasurementId = 1;

const COLOR_CYAN = 0x00d4ff;

// Estado da lupa (segundo WebGLRenderer em canvas dedicado).
let loupeRenderer = null;
let loupeCamera = null;
let loupeTarget = null;
let loupeOpen = false;
const LOUPE_ZOOM = 3.0;

export function init(canvasEl) {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x272425);

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

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 3);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // CSS2DRenderer: HTML overlay alinhado a coordenadas 3D (usado pela pílula da medição).
  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(window.innerWidth, window.innerHeight);
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
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    scene,
    camera,
  );
  outlinePass.edgeStrength = 6;
  outlinePass.edgeGlow = 0.3;
  outlinePass.edgeThickness = 2;
  outlinePass.pulsePeriod = 0;       // sem pulse (já temos pulse no candidato)
  outlinePass.visibleEdgeColor.setHex(COLOR_CYAN);
  outlinePass.hiddenEdgeColor.setHex(COLOR_CYAN);
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());

  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(tick);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
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
  // Billboard + pulse: candidate sempre olha a câmera e tem leve respiração
  // (1.0 → 1.08 → 1.0, ciclo ~1.5s) pra sinalizar afordância de drag.
  const pulseScale = 1 + 0.08 * Math.sin(performance.now() * 0.004);
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
      // Permanent transparent + depthWrite avoids visual hitches when the
      // slider crosses the 1.0 → 0.99 boundary. Toggling these per-frame
      // caused depth buffer to abruptly stop writing, making the mesh look
      // like ghost glass at 99%. Now `opacity` is the only knob that moves.
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
    mesh.material.opacity = lastOpacity.get(name) ?? 1;
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
}

export function setOpacity(name, value) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return;
  mesh.material.opacity = value;
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
  return "#" + mesh.material.color.getHexString();
}

export function getMeshNames() {
  return Array.from(namedMeshes.keys());
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
  const mat = new THREE.MeshBasicMaterial({ color: COLOR_CYAN, depthTest: false });
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
  const radius = 2.5;
  const segments = 64;

  // Anel tracejado externo
  const ringPositions = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ringPositions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  }
  const ringGeom = new THREE.BufferGeometry();
  ringGeom.setAttribute("position", new THREE.Float32BufferAttribute(ringPositions, 3));
  const ringMat = new THREE.LineDashedMaterial({
    color: COLOR_CYAN,
    dashSize: 0.5,
    gapSize: 0.35,
    depthTest: false,
    linewidth: 2,
  });
  const ring = new THREE.Line(ringGeom, ringMat);
  ring.computeLineDistances();

  // Dot branco central (afordância de "centro do alvo / agarrável")
  const dotGeom = new THREE.CircleGeometry(0.5, 16);
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
  measurementObjects.set(id, { type: "candidate", object3D: group });
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
  // Candidato agora é um Group (anel + dot); descartar recursos dos filhos.
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
    color: COLOR_CYAN,
    linewidth: LINE_WIDTH_PX,
    transparent: true,
    depthTest: false,           // linha sempre na frente das estruturas
    dashed: !!provisional,
    dashSize: LINE_DASH_SIZE,
    gapSize: LINE_GAP_SIZE,
    dashScale: 1,
  });
  mat.resolution.set(window.innerWidth, window.innerHeight);
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

export function addPill(midpoint3D, text) {
  const id = nextMeasurementId++;
  const el = document.createElement("div");
  el.className = "measurement-pill";
  el.textContent = text;
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
