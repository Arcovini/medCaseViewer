// case-next/world.js
// Tudo dentro do canvas (Three.js). Não toca em DOM além do canvas que recebe.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

let renderer, scene, camera, controls;
let pmremGenerator;
const namedMeshes = new Map();
const lastOpacity = new Map();   // name -> último valor não-zero (default fallback é 1.0)
let mountedRoot = null;

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

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 3);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(tick);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function tick() {
  controls.update();
  renderer.render(scene, camera);
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

function applyMaterialOpacity(mat, value) {
  mat.opacity = value;
}

export function setVisibility(name, visible) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return;
  if (visible) {
    const v = lastOpacity.get(name) ?? 1;
    applyMaterialOpacity(mesh.material, v);
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
  applyMaterialOpacity(mesh.material, value);
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
