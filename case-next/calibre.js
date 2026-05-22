// case-next/calibre.js
// Máquina de estado do modo Calibre (diâmetro de vaso).
// Espelha a forma do measurement.js e volume.js.
//
// Fluxo: PLACING_P1 → CANDIDATE_P1 → EXTRACTING_CL
//        → READY_SHORT (só P1)
//             ├─ tap centerline → CIRCLE_PLACED
//             └─ tap mesh      → PLACING_P2 → CANDIDATE_P2 → EXTRACTING_CL_P1P2 → READY_LONG
//                                                                                  └─ tap centerline → CIRCLE_PLACED
//        → CIRCLE_PLACED
//             ├─ drag centerline    → atualiza ao vivo
//             ├─ confirm            → COMMITTED (pin) → permite + Nova
//             └─ cancel             → READY_*
//
// Multi-medição: após confirm, _committed[] guarda {circle, pill, ...}.
// + Nova reinicia em PLACING_P1.

import * as geom from "./calibre-geom.js";

const STATE = Object.freeze({
  IDLE: "idle",
  PLACING_P1: "placing-p1",
  CANDIDATE_P1: "candidate-p1",
  EXTRACTING_CL: "extracting-cl",
  READY_SHORT: "ready-short",
  PLACING_P2: "placing-p2",
  CANDIDATE_P2: "candidate-p2",
  EXTRACTING_CL_P1P2: "extracting-cl-p1p2",
  READY_LONG: "ready-long",
  CIRCLE_PLACED: "circle-placed",
  COMMITTED: "committed",
});

const TAP_THRESHOLD_PX = 15;
const TAP_THRESHOLD_MS = 500;
const HANDLE_HITBOX_PX = 44;
const CENTERLINE_PICK_THRESHOLD_PX = 22;

let _world = null;
let _dom = null;
let _hint = null;
let _toolbar = null;
let _loupe = null;
let _onExit = null;

let _state = STATE.IDLE;

// Estado transiente (antes de pin)
let _candidate = null;          // { id, point3D, meshName, faceIndex }
let _P1 = null;                 // { id (endpoint), point3D, meshName, faceIndex }
let _P2 = null;
let _centerlineId = null;
let _circleId = null;
let _pillId = null;
let _circleData = null;         // { center, tangent, diameter }
let _highlightedMeshName = null;

// Medições já confirmadas (pin) — persistem até exit ou recarga
const _committed = [];          // { circleId, pillId, meshName, diameter, center, tangent }

let _touch = null;              // pointer tracking

export function init({ world, dom, hint, onExit }) {
  _world = world;
  _dom = dom;
  _hint = hint;
  _onExit = onExit;

  _toolbar = dom.mountCalibreToolbar({
    onCancel: _exit,
    onConfirm: _onConfirm,
    onNew: _onNew,
    onExit: _exit,
  });

  _loupe = dom.mountLoupe();
  world.attachLoupeCanvas(_loupe.canvas);

  world.onCameraChange(() => {
    if (_loupe && (_state === STATE.CANDIDATE_P1 || _state === STATE.CANDIDATE_P2) && _candidate) {
      const screen = _world.projectToScreen(_candidate.point3D);
      _loupe.setPosition(screen.x, screen.y);
    }
  });

  const canvas = document.getElementById("canvas");
  canvas.addEventListener("pointerdown", _onPointerDown);
  canvas.addEventListener("pointermove", _onPointerMove);
  canvas.addEventListener("pointerup",   _onPointerUp);
  canvas.addEventListener("pointercancel", _onPointerUp);

  _enter(STATE.IDLE);

  return {
    startCalibre,
    getState: () => _state,
    getCommittedCount: () => _committed.length,
    onMeshVisibilityChange,
  };
}

function startCalibre() {
  _enter(STATE.PLACING_P1);
}

function _exit() {
  _clearTransient();
  _clearCommitted();
  _state = STATE.IDLE;
  _hint.clear();
  _toolbar.hide();
  if (_onExit) _onExit();
}

function _clearCommitted() {
  for (const c of _committed) {
    if (c.circleId !== null) _world.removeDiameterCircle(c.circleId);
    if (c.pillId !== null) _world.removePill(c.pillId);
  }
  _committed.length = 0;
}

// Quando uma malha tem visibility alternada (eye-toggle), esconde medições
// ancoradas a ela (similar a measurement.js:104-110).
function onMeshVisibilityChange(meshName, isVisible) {
  for (const c of _committed) {
    if (c.meshName !== meshName) continue;
    _world.setMeasurementVisibility([c.circleId, c.pillId], isVisible);
  }
  // Centerline transiente + circle transiente
  if (_P1 && _P1.meshName === meshName) {
    const transientIds = [];
    if (_centerlineId !== null) transientIds.push(_centerlineId);
    if (_circleId !== null) transientIds.push(_circleId);
    if (_pillId !== null) transientIds.push(_pillId);
    if (transientIds.length) _world.setMeasurementVisibility(transientIds, isVisible);
  }
}

// ===========================================================================
// State transitions
// ===========================================================================

function _enter(next) {
  _state = next;
  switch (next) {
    case STATE.IDLE:
      _hint.clear();
      _toolbar.hide();
      break;
    case STATE.PLACING_P1:
      _hint.setText("Toque no vaso para colocar o primeiro ponto");
      _toolbar.showCancelOnly();
      break;
    case STATE.CANDIDATE_P1:
      _hint.setText("Arraste para ajustar, ou toque em outro ponto");
      _toolbar.showConfirmRow("P1");
      break;
    case STATE.EXTRACTING_CL:
      _hint.setText("Calculando linha central…");
      _toolbar.showCancelOnly();
      break;
    case STATE.READY_SHORT:
      _hint.setText("Toque na linha para medir, ou em um 2º ponto do mesmo vaso");
      _toolbar.showCancelOnly();
      break;
    case STATE.PLACING_P2:
      _hint.setText("Toque no segundo ponto do mesmo vaso");
      _toolbar.showCancelOnly();
      break;
    case STATE.CANDIDATE_P2:
      _hint.setText("Arraste para ajustar, ou toque em outro ponto");
      _toolbar.showConfirmRow("P2");
      break;
    case STATE.EXTRACTING_CL_P1P2:
      _hint.setText("Conectando os pontos pelo interior do vaso…");
      _toolbar.showCancelOnly();
      break;
    case STATE.READY_LONG:
      _hint.setText("Toque na linha para medir o calibre");
      _toolbar.showCancelOnly();
      break;
    case STATE.CIRCLE_PLACED:
      _hint.setText("Arraste o círculo (sobre a linha) ou confirme");
      _toolbar.showResultRow();
      break;
    case STATE.COMMITTED:
      _hint.setText("Toque na linha para nova medida, ou + Nova para outro vaso");
      _toolbar.showCommittedRow();
      break;
  }
}

// Limpa tudo que é transiente (não-comprometido). Não toca _committed.
function _clearTransient() {
  _clearCandidate();
  if (_P1) { _world.removeEndpoint(_P1.id); _P1 = null; }
  if (_P2) { _world.removeEndpoint(_P2.id); _P2 = null; }
  if (_centerlineId !== null) { _world.removeCenterline(_centerlineId); _centerlineId = null; }
  if (_circleId !== null) { _world.removeDiameterCircle(_circleId); _circleId = null; }
  if (_pillId !== null) { _world.removePill(_pillId); _pillId = null; }
  _circleData = null;
}

function _clearCandidate() {
  if (_candidate) {
    _world.removeCandidate(_candidate.id);
    _candidate = null;
  }
  if (_highlightedMeshName) {
    _world.setMeshHighlight(_highlightedMeshName, false);
    _highlightedMeshName = null;
  }
  _world.closeLoupe();
  _loupe.setVisible(false);
}

// ===========================================================================
// Confirm / + Nova
// ===========================================================================

function _onConfirm() {
  if (_state === STATE.CANDIDATE_P1) {
    if (!_candidate) return;
    const epId = _world.addEndpoint(_candidate.point3D, "P1");
    _P1 = {
      id: epId,
      point3D: _candidate.point3D.clone(),
      meshName: _candidate.meshName,
      faceIndex: _candidate.faceIndex,
    };
    _clearCandidate();
    _enter(STATE.EXTRACTING_CL);
    // Defer pra deixar o paint do hint acontecer antes do trabalho pesado
    setTimeout(_runExtractionP1Only, 0);
  } else if (_state === STATE.CANDIDATE_P2) {
    if (!_candidate) return;
    if (_candidate.meshName !== _P1.meshName) {
      _hint.setText("P2 deve estar no mesmo vaso de P1. Tente novamente.");
      return;
    }
    const epId = _world.addEndpoint(_candidate.point3D, "P2");
    _P2 = {
      id: epId,
      point3D: _candidate.point3D.clone(),
      meshName: _candidate.meshName,
      faceIndex: _candidate.faceIndex,
    };
    _clearCandidate();
    _enter(STATE.EXTRACTING_CL_P1P2);
    setTimeout(_runExtractionP1P2, 0);
  } else if (_state === STATE.CIRCLE_PLACED) {
    if (!_circleData || _circleId === null) return;
    // Pin: move o circle/pill transiente pra _committed e zera as refs.
    _committed.push({
      circleId: _circleId,
      pillId:   _pillId,
      meshName: _P1.meshName,
      diameter: _circleData.diameter,
      center: _circleData.center.clone(),
      tangent: _circleData.tangent.clone(),
    });
    _circleId = null;
    _pillId = null;
    _circleData = null;
    _enter(STATE.COMMITTED);
  }
}

function _onNew() {
  _clearTransient();
  _enter(STATE.PLACING_P1);
}

// ===========================================================================
// Centerline extraction (chama calibre-geom.js)
// ===========================================================================

function _runExtractionP1Only() {
  const soup = _world.getMeshTriangleSoup(_P1.meshName);
  if (!soup) {
    _hint.setText("Erro: malha não carregada.");
    return _enter(STATE.PLACING_P1);
  }
  const normal = _world.getMeshFaceNormalWorld(_P1.meshName, _P1.faceIndex);
  if (!normal) {
    _hint.setText("Erro: não foi possível ler a face do vaso.");
    return _enter(STATE.PLACING_P1);
  }

  const result = geom.extractCenterline({
    soup,
    P1: _P1.point3D,
    P1_normal: normal,
    raycastInternal: (origin, dir) => _world.raycastInternal(_P1.meshName, origin, dir),
  });

  if (!result || !result.points || result.points.length < 1) {
    _hint.setText("Não foi possível encontrar o lume do vaso. Tente outro ponto.");
    _world.removeEndpoint(_P1.id);
    _P1 = null;
    return _enter(STATE.PLACING_P1);
  }

  _centerlineId = _world.addCenterline(result.points);

  if (!result.isTubular) {
    _hint.setText("Aviso: a estrutura não parece muito tubular. Resultado pode ser aproximado.");
    setTimeout(() => { if (_state === STATE.READY_SHORT) _enter(STATE.READY_SHORT); }, 2500);
  }
  _enter(STATE.READY_SHORT);
}

function _runExtractionP1P2() {
  if (_P1.meshName !== _P2.meshName) {
    _hint.setText("P2 deve estar no MESMO vaso de P1.");
    _world.removeEndpoint(_P2.id);
    _P2 = null;
    return _enter(STATE.READY_SHORT);
  }
  const soup = _world.getMeshTriangleSoup(_P1.meshName);
  if (!soup) return _enter(STATE.READY_SHORT);

  const normal1 = _world.getMeshFaceNormalWorld(_P1.meshName, _P1.faceIndex);
  const normal2 = _world.getMeshFaceNormalWorld(_P2.meshName, _P2.faceIndex);

  const result = geom.extractCenterline({
    soup,
    P1: _P1.point3D,
    P1_normal: normal1,
    P2: _P2.point3D,
    P2_normal: normal2,
    raycastInternal: (origin, dir) => _world.raycastInternal(_P1.meshName, origin, dir),
  });

  if (result && result.points && result.points.length >= 2) {
    if (_centerlineId !== null) _world.removeCenterline(_centerlineId);
    _centerlineId = _world.addCenterline(result.points, {
      dashed: result.fallback === "straight",
    });
    if (result.fallback === "straight") {
      _hint.setText("Não consegui traçar a curva exata — usando linha aproximada.");
    }
  }
  _enter(STATE.READY_LONG);
}

// ===========================================================================
// Pointer handling (tap vs drag)
// ===========================================================================

function _isInActiveMode() {
  return _state !== STATE.IDLE && _state !== STATE.ASKING_VESSEL_TYPE;
}

function _onPointerDown(e) {
  if (!_isInActiveMode()) return;
  if (e.pointerType !== "mouse" && e.pointerType !== "touch" && e.pointerType !== "pen") return;

  let onHandle = false;
  if ((_state === STATE.CANDIDATE_P1 || _state === STATE.CANDIDATE_P2) && _candidate) {
    const projected = _world.projectToScreen(_candidate.point3D);
    const dx = e.clientX - projected.x;
    const dy = e.clientY - projected.y;
    onHandle = Math.hypot(dx, dy) < HANDLE_HITBOX_PX / 2;
  }

  let onCenterline = false;
  if (_centerlineId !== null &&
      (_state === STATE.READY_SHORT || _state === STATE.READY_LONG ||
       _state === STATE.CIRCLE_PLACED || _state === STATE.COMMITTED)) {
    const hit = _world.pickPointOnCenterline(_centerlineId, e.clientX, e.clientY, CENTERLINE_PICK_THRESHOLD_PX);
    onCenterline = !!hit;
  }

  if (onHandle || onCenterline) _world.setControlsEnabled(false);

  _touch = {
    startX: e.clientX, startY: e.clientY, startT: performance.now(),
    isOnHandle: onHandle,
    isOnCenterline: onCenterline,
    isDragging: false,
  };
}

function _onPointerMove(e) {
  if (!_touch) return;
  const dx = e.clientX - _touch.startX;
  const dy = e.clientY - _touch.startY;
  if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) _touch.isDragging = true;

  if (_touch.isOnHandle && _touch.isDragging && _candidate) {
    const hit = _world.raycastFromScreen(e.clientX, e.clientY);
    if (!hit) return;
    // Em CANDIDATE_P2, restringe drag ao mesmo mesh do P1
    if (_state === STATE.CANDIDATE_P2 && hit.meshName !== _P1.meshName) return;

    _candidate.point3D.copy(hit.point3D);
    _candidate.faceIndex = hit.faceIndex;
    _world.moveCandidate(_candidate.id, hit.point3D);
    if (_highlightedMeshName !== hit.meshName) {
      if (_highlightedMeshName) _world.setMeshHighlight(_highlightedMeshName, false);
      _world.setMeshHighlight(hit.meshName, true);
      _highlightedMeshName = hit.meshName;
      _candidate.meshName = hit.meshName;
      _loupe.setLabel(hit.meshName);
    }
    _world.updateLoupe({ point3D: hit.point3D });
    _loupe.setPosition(e.clientX, e.clientY);
  } else if (_touch.isOnCenterline && _touch.isDragging) {
    // Drag circle along centerline (READY ou CIRCLE_PLACED)
    _dragCircleAtScreen(e.clientX, e.clientY);
  }
}

function _onPointerUp(e) {
  if (!_touch) return;
  const wasOnHandle = _touch.isOnHandle;
  const wasOnCenterline = _touch.isOnCenterline;
  const wasDragging = _touch.isDragging;
  const isTap =
    Math.hypot(e.clientX - _touch.startX, e.clientY - _touch.startY) < TAP_THRESHOLD_PX &&
    (performance.now() - _touch.startT) < TAP_THRESHOLD_MS;

  if (isTap && !wasOnHandle && !wasOnCenterline) {
    _handleTap(e.clientX, e.clientY);
  } else if (isTap && wasOnCenterline) {
    // Tap em cima da centerline: coloca/move o círculo
    if (_state === STATE.READY_SHORT || _state === STATE.READY_LONG ||
        _state === STATE.CIRCLE_PLACED || _state === STATE.COMMITTED) {
      _placeCircleAtScreen(e.clientX, e.clientY);
    }
  } else if (wasDragging && wasOnCenterline && _state === STATE.READY_SHORT) {
    // Se arrastou sobre a centerline ainda em READY, transição pra CIRCLE_PLACED
    if (_circleId !== null) _enter(STATE.CIRCLE_PLACED);
  } else if (wasDragging && wasOnCenterline && _state === STATE.READY_LONG) {
    if (_circleId !== null) _enter(STATE.CIRCLE_PLACED);
  } else if (wasDragging && wasOnCenterline && _state === STATE.COMMITTED) {
    if (_circleId !== null) _enter(STATE.CIRCLE_PLACED);
  }

  if (wasOnHandle || wasOnCenterline) _world.setControlsEnabled(true);
  _touch = null;
}

function _handleTap(screenX, screenY) {
  if (_state === STATE.PLACING_P1 || _state === STATE.CANDIDATE_P1) {
    _placeCandidateP1AtScreen(screenX, screenY);
  } else if (_state === STATE.PLACING_P2 || _state === STATE.CANDIDATE_P2) {
    _placeCandidateP2AtScreen(screenX, screenY);
  } else if (_state === STATE.READY_SHORT || _state === STATE.READY_LONG) {
    // Tap fora da centerline: se for no mesmo mesh do P1, vira PLACING_P2
    const hit = _world.raycastFromScreen(screenX, screenY);
    if (hit && hit.meshName === _P1.meshName && _state === STATE.READY_SHORT) {
      _placeCandidateP2AtScreen(screenX, screenY);
    } else if (hit && hit.meshName !== _P1.meshName) {
      _hint.setText("Toque no MESMO vaso de P1 (ou na linha central)");
    }
    // Em READY_LONG, tap fora da centerline não faz nada
  }
}

function _placeCandidateP1AtScreen(screenX, screenY) {
  const hit = _world.raycastFromScreen(screenX, screenY);
  if (!hit) return;
  _clearCandidate();
  const id = _world.addCandidate(hit.point3D);
  _candidate = { id, point3D: hit.point3D.clone(), meshName: hit.meshName, faceIndex: hit.faceIndex };
  _highlightedMeshName = hit.meshName;
  _world.setMeshHighlight(hit.meshName, true);
  _world.openLoupe({ point3D: hit.point3D });
  _loupe.setLabel(hit.meshName);
  _loupe.setPosition(screenX, screenY);
  _loupe.setVisible(true);
  if (_state !== STATE.CANDIDATE_P1) _enter(STATE.CANDIDATE_P1);
}

function _placeCandidateP2AtScreen(screenX, screenY) {
  const hit = _world.raycastFromScreen(screenX, screenY);
  if (!hit) return;
  if (hit.meshName !== _P1.meshName) {
    _hint.setText("P2 deve estar no MESMO vaso que P1.");
    return;
  }
  _clearCandidate();
  const id = _world.addCandidate(hit.point3D);
  _candidate = { id, point3D: hit.point3D.clone(), meshName: hit.meshName, faceIndex: hit.faceIndex };
  _highlightedMeshName = hit.meshName;
  _world.setMeshHighlight(hit.meshName, true);
  _world.openLoupe({ point3D: hit.point3D });
  _loupe.setLabel(hit.meshName);
  _loupe.setPosition(screenX, screenY);
  _loupe.setVisible(true);
  if (_state !== STATE.CANDIDATE_P2) _enter(STATE.CANDIDATE_P2);
}

function _placeCircleAtScreen(screenX, screenY) {
  if (_centerlineId === null || !_P1) return;
  const hit = _world.pickPointOnCenterline(_centerlineId, screenX, screenY, CENTERLINE_PICK_THRESHOLD_PX);
  if (!hit) return;
  const soup = _world.getMeshTriangleSoup(_P1.meshName);
  if (!soup) return;

  const result = geom.diameterAt(soup, hit.point3D, hit.tangent);
  if (!result) {
    _hint.setText("Não foi possível medir nesse ponto. Tente em outro lugar da linha.");
    return;
  }
  _circleData = {
    center:   hit.point3D.clone(),
    tangent:  hit.tangent.clone(),
    diameter: result.diameter,
  };

  if (_circleId === null) {
    _circleId = _world.addDiameterCircle(_circleData.center, _circleData.tangent, _circleData.diameter / 2);
    _pillId = _world.addPill(_circleData.center, _formatDiameter(result.diameter));
  } else {
    _world.updateDiameterCircle(_circleId, _circleData.center, _circleData.tangent, _circleData.diameter / 2);
    _world.updatePill(_pillId, _circleData.center, _formatDiameter(result.diameter));
  }
  if (_state !== STATE.CIRCLE_PLACED) _enter(STATE.CIRCLE_PLACED);
}

function _dragCircleAtScreen(screenX, screenY) {
  if (_centerlineId === null || !_P1) return;
  const hit = _world.pickPointOnCenterline(_centerlineId, screenX, screenY, CENTERLINE_PICK_THRESHOLD_PX);
  if (!hit) return;
  const soup = _world.getMeshTriangleSoup(_P1.meshName);
  if (!soup) return;
  const result = geom.diameterAt(soup, hit.point3D, hit.tangent);
  if (!result) return;
  _circleData = _circleData || {
    center: hit.point3D.clone(), tangent: hit.tangent.clone(), diameter: result.diameter,
  };
  _circleData.center.copy(hit.point3D);
  _circleData.tangent.copy(hit.tangent);
  _circleData.diameter = result.diameter;
  if (_circleId === null) {
    _circleId = _world.addDiameterCircle(hit.point3D, hit.tangent, result.diameter / 2);
    _pillId = _world.addPill(hit.point3D, _formatDiameter(result.diameter));
  } else {
    _world.updateDiameterCircle(_circleId, hit.point3D, hit.tangent, result.diameter / 2);
    _world.updatePill(_pillId, hit.point3D, _formatDiameter(result.diameter));
  }
}

function _formatDiameter(d) {
  return `${d.toFixed(1).replace(".", ",")} mm`;
}
