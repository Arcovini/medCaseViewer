// case/volume.js
// Máquina de estado do modo Volume. Espelha a forma do measurement.js.
// Calcula volume real de malhas via world.computeMeshVolumeCached.

const STATE = Object.freeze({
  IDLE: "idle",
  ACTIVE_EMPTY: "active-empty",
  ACTIVE_RESULT: "active-result",
});

const TAP_THRESHOLD_PX = 15;
const TAP_THRESHOLD_MS = 500;

let _world = null;
let _dom = null;
let _hint = null;
let _toolbar = null;
let _onExit = null;

let _state = STATE.IDLE;
let _measuredMeshName = null;
let _pillId = null;
let _pillText = null;
let _touch = null;

export function init({ world, dom, hint, onExit }) {
  _world = world;
  _dom = dom;
  _hint = hint;
  _onExit = onExit;

  _toolbar = dom.mountVolumeToolbar({
    onNew: () => _enter(STATE.ACTIVE_EMPTY),
    onExit: _exit,
  });

  const canvas = document.getElementById("canvas");
  canvas.addEventListener("pointerdown", _onPointerDown);
  canvas.addEventListener("pointerup", _onPointerUp);
  canvas.addEventListener("pointercancel", () => { _touch = null; });

  return {
    startVolume,
    getState: () => _state,
    getMeasuredMesh: () => _measuredMeshName,
    getPillText: () => _pillText,
  };
}

function startVolume() {
  _enter(STATE.ACTIVE_EMPTY);
}

function _exit() {
  _enter(STATE.IDLE);
  if (_onExit) _onExit();
}

function _enter(next) {
  _clearMeasurement();
  _state = next;

  switch (next) {
    case STATE.IDLE:
      _hint.clear();
      _toolbar.hide();
      break;
    case STATE.ACTIVE_EMPTY:
      _hint.setText("Toque na estrutura para medir o volume");
      _toolbar.showEmpty();
      break;
    case STATE.ACTIVE_RESULT:
      _hint.clear();
      _toolbar.showResult();
      break;
  }
}

function _clearMeasurement() {
  if (_measuredMeshName) {
    _world.setMeshHighlight(_measuredMeshName, false);
    _measuredMeshName = null;
  }
  if (_pillId !== null) {
    _world.removePill(_pillId);
    _pillId = null;
  }
  _pillText = null;
}

function _onPointerDown(e) {
  if (_state !== STATE.ACTIVE_EMPTY && _state !== STATE.ACTIVE_RESULT) return;
  if (e.pointerType !== "mouse" && e.pointerType !== "touch" && e.pointerType !== "pen") return;
  _touch = {
    startX: e.clientX,
    startY: e.clientY,
    startT: performance.now(),
  };
}

function _onPointerUp(e) {
  if (!_touch) return;

  const dt = performance.now() - _touch.startT;
  const dx = e.clientX - _touch.startX;
  const dy = e.clientY - _touch.startY;
  const dist = Math.hypot(dx, dy);
  const isTap = dist < TAP_THRESHOLD_PX && dt < TAP_THRESHOLD_MS;

  _touch = null;
  if (!isTap) return;
  if (_state !== STATE.ACTIVE_EMPTY && _state !== STATE.ACTIVE_RESULT) return;

  _measureAtScreen(e.clientX, e.clientY);
}

function _measureAtScreen(screenX, screenY) {
  const hit = _world.raycastFromScreen(screenX, screenY);
  if (!hit) return;   // tap em vácuo: ignorado silenciosamente

  // Se já há uma medição (mesma ou outra mesh), limpar antes de aplicar a nova.
  _clearMeasurement();

  const result = _world.computeMeshVolumeCached(hit.meshName);
  if (!result) return;

  _measuredMeshName = hit.meshName;
  _world.setMeshHighlight(hit.meshName, true);

  _pillText = _formatPill(result);
  const centroid = _world.getMeshCentroid(hit.meshName);
  _pillId = _world.addPill(centroid, _pillText, { warn: !result.manifold });

  // Transição direta pra ACTIVE_RESULT — _enter() chamaria _clearMeasurement
  // novamente e perderia o que acabamos de criar.
  _state = STATE.ACTIVE_RESULT;
  _hint.clear();
  _toolbar.showResult();
}

function _formatPill({ volumeCm3, manifold }) {
  const value = volumeCm3.toFixed(1).replace(".", ",");
  return manifold ? `${value} cm³` : `~${value} cm³`;
}
