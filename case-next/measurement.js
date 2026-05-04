// case-next/measurement.js
// Máquina de estado da medição linear. Não importa THREE; não usa document.querySelector
// diretamente. Recebe APIs de world e dom em init().

const STATE = Object.freeze({
  IDLE: "idle",
  PLACING_P1: "placing-p1",
  PLACING_P2: "placing-p2",
  RESULT: "result",
});

const TAP_THRESHOLD_PX = 15;
const TAP_THRESHOLD_MS = 500;
const HANDLE_HITBOX_PX = 44;
const SHORT_LINE_THRESHOLD_PX = 60;
const SHORT_LINE_OFFSET_PX = 14;

let _world = null;
let _dom = null;
let _fab = null;
let _hint = null;
let _toolbar = null;
let _loupe = null;

let _state = STATE.IDLE;
let _candidate = null;          // { id, point3D, meshName }
let _endpoints = [];            // [{ id, point3D, meshName }, ...]
let _lineId = null;
let _pillId = null;
let _pillCache = null;          // texto da pílula (cache p/ getPillText)
let _highlightedMeshName = null;

// Pointer tracking
let _touch = null;              // { startX, startY, startT, isOnHandle, isDragging }

export function init({ world, dom }) {
  _world = world;
  _dom = dom;

  _fab = dom.mountMeasurementFAB({
    onStart: () => _enter(STATE.PLACING_P1),
    onCancel: () => _enter(STATE.IDLE),
  });
  _hint = dom.mountHintBanner();
  _toolbar = dom.mountMiniToolbar({
    onConfirm: _onConfirm,
    onCancel: () => _enter(STATE.IDLE),
    onClear: () => _enter(STATE.IDLE),
    onNew: () => _enter(STATE.PLACING_P1),
  });
  _loupe = dom.mountLoupe();
  world.attachLoupeCanvas(_loupe.canvas);

  // Reposiciona pílula offset quando câmera muda — linha pode encolher na tela.
  world.onCameraChange(() => {
    if (_state === STATE.RESULT) _applyPillOffsetIfShort();
    if (_loupe && (_state === STATE.PLACING_P1 || _state === STATE.PLACING_P2) && _candidate) {
      const screen = _world.projectToScreen(_candidate.point3D);
      _loupe.setPosition(screen.x, screen.y);
    }
  });

  // Listeners no canvas pra detectar tap vs drag.
  const canvas = document.getElementById("canvas");
  canvas.addEventListener("pointerdown", _onPointerDown);
  canvas.addEventListener("pointermove", _onPointerMove);
  canvas.addEventListener("pointerup", _onPointerUp);
  canvas.addEventListener("pointercancel", _onPointerUp);

  _fab.setVisible(true);
  _enter(STATE.IDLE);

  return {
    getState: () => _state,
    getCandidate: () => _candidate
      ? { point3D: _candidate.point3D.clone(), meshName: _candidate.meshName }
      : null,
    getEndpoints: () => _endpoints.map(e => ({
      point3D: e.point3D.clone(),
      meshName: e.meshName,
    })),
    getLine: () => (_endpoints.length === 2 && _lineId !== null)
      ? {
          p1: _endpoints[0].point3D.clone(),
          p2: _endpoints[1].point3D.clone(),
          distanceMm: _endpoints[0].point3D.distanceTo(_endpoints[1].point3D),
        }
      : null,
    getPillText: () => _pillCache,
    getLoupeOpen: () => _candidate !== null,
    getHighlightedMesh: () => _highlightedMeshName,
    onMeshVisibilityChange,
  };
}

// Hook chamado pelo main.js quando uma malha tem visibility alternada (eye-toggle).
// Se a malha-âncora de uma medição confirmada for ocultada, esconde a medição inteira.
function onMeshVisibilityChange(meshName, isVisible) {
  if (_state !== STATE.RESULT || _endpoints.length !== 2) return;
  const isAnchor = _endpoints.some(e => e.meshName === meshName);
  if (!isAnchor) return;
  const ids = [..._endpoints.map(e => e.id), _lineId, _pillId].filter(id => id !== null);
  _world.setMeasurementVisibility(ids, isVisible);
}

// ---------------------------------------------------------------------------
// Transições de estado
// ---------------------------------------------------------------------------

function _enter(next) {
  _clearAll();
  _state = next;

  switch (next) {
    case STATE.IDLE:
      _fab.setState("idle");
      _fab.setVisible(true);
      _hint.clear();
      _toolbar.hide();
      break;
    case STATE.PLACING_P1:
      // FAB escondido durante placing — toolbar inferior cuida do cancelar.
      // Antes o FAB virava "✕ Cancelar" no top-right e em mobile sobrepunha
      // o hint banner.
      _fab.setVisible(false);
      _hint.setText("Toque na estrutura para colocar o ponto");
      _toolbar.hide();
      break;
    case STATE.PLACING_P2:
      _fab.setVisible(false);
      _hint.setText("Toque para colocar o segundo ponto");
      _toolbar.hide();
      break;
    case STATE.RESULT:
      // Em result o toolbar (Limpar / Nova) cuida das ações; FAB fica oculto.
      _fab.setVisible(false);
      _hint.clear();
      _toolbar.showResultRow();
      break;
  }
}

function _clearAll() {
  _clearCandidate();
  for (const e of _endpoints) _world.removeEndpoint(e.id);
  _endpoints = [];
  if (_lineId !== null) { _world.removeLine(_lineId); _lineId = null; }
  if (_pillId !== null) { _world.removePill(_pillId); _pillId = null; }
  _pillCache = null;
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

// ---------------------------------------------------------------------------
// Confirm / try-again
// ---------------------------------------------------------------------------

function _onConfirm() {
  if (!_candidate) return;

  if (_state === STATE.PLACING_P1) {
    const epId = _world.addEndpoint(_candidate.point3D, "P1");
    _endpoints.push({ id: epId, point3D: _candidate.point3D.clone(), meshName: _candidate.meshName });
    _clearCandidate();
    _toolbar.hide();
    _state = STATE.PLACING_P2;
    _hint.setText("Toque para colocar o segundo ponto");
  } else if (_state === STATE.PLACING_P2) {
    const epId = _world.addEndpoint(_candidate.point3D, "P2");
    _endpoints.push({ id: epId, point3D: _candidate.point3D.clone(), meshName: _candidate.meshName });
    _clearCandidate();

    if (_lineId !== null) {
      _world.updateLineProvisional(_lineId, false);
    } else {
      _lineId = _world.addLine(_endpoints[0].point3D, _endpoints[1].point3D, { provisional: false });
    }

    const distMm = _endpoints[0].point3D.distanceTo(_endpoints[1].point3D);
    _pillCache = `${distMm.toFixed(1).replace(".", ",")} mm`;
    const mid = _endpoints[0].point3D.clone().add(_endpoints[1].point3D).multiplyScalar(0.5);
    _pillId = _world.addPill(mid, _pillCache);
    _applyPillOffsetIfShort();

    // Não chamar _enter(RESULT) porque ele zera tudo via _clearAll. Aplicar transição direta.
    _state = STATE.RESULT;
    _fab.setVisible(false);
    _hint.clear();
    _toolbar.showResultRow();
  }
}

// (Removido _onTryAgain — botão "Tentar de novo" foi substituído pelo
// re-tap natural em outra posição, e "✕ Cancelar" agora vive no toolbar
// inferior cancelando a medição inteira via _enter(STATE.IDLE).)

// ---------------------------------------------------------------------------
// Tap vs drag detection
// ---------------------------------------------------------------------------

function _onPointerDown(e) {
  if (_state !== STATE.PLACING_P1 && _state !== STATE.PLACING_P2) return;
  if (e.pointerType !== "mouse" && e.pointerType !== "touch" && e.pointerType !== "pen") return;

  let onHandle = false;
  if (_candidate) {
    const projected = _world.projectToScreen(_candidate.point3D);
    const dx = e.clientX - projected.x;
    const dy = e.clientY - projected.y;
    onHandle = Math.hypot(dx, dy) < HANDLE_HITBOX_PX / 2;
  }
  if (onHandle) _world.setControlsEnabled(false);

  _touch = {
    startX: e.clientX,
    startY: e.clientY,
    startT: performance.now(),
    isOnHandle: onHandle,
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
    if (!hit) return;     // se sair da malha, ignora o frame

    _candidate.point3D.copy(hit.point3D);
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

    if (_state === STATE.PLACING_P2 && _lineId !== null) {
      _world.updateLineEnd(_lineId, hit.point3D);
    }
  }
}

function _onPointerUp(e) {
  if (!_touch) return;
  const wasOnHandle = _touch.isOnHandle;

  const dt = performance.now() - _touch.startT;
  const dx = e.clientX - _touch.startX;
  const dy = e.clientY - _touch.startY;
  const dist = Math.hypot(dx, dy);
  const isTap = dist < TAP_THRESHOLD_PX && dt < TAP_THRESHOLD_MS;

  if (isTap && !wasOnHandle) {
    _placeCandidateAtScreen(e.clientX, e.clientY);
  }

  if (wasOnHandle) _world.setControlsEnabled(true);
  _touch = null;
}

// ---------------------------------------------------------------------------
// Colocação inicial / re-colocação de candidato
// ---------------------------------------------------------------------------

function _placeCandidateAtScreen(screenX, screenY) {
  const hit = _world.raycastFromScreen(screenX, screenY);
  if (!hit) return;     // tap em vácuo: ignorado silenciosamente

  // Remove candidato anterior (se houver) — mas mantém endpoints já confirmados.
  _clearCandidate();

  const id = _world.addCandidate(hit.point3D);
  _candidate = { id, point3D: hit.point3D.clone(), meshName: hit.meshName };
  _highlightedMeshName = hit.meshName;
  _world.setMeshHighlight(hit.meshName, true);
  _world.openLoupe({ point3D: hit.point3D });
  _loupe.setLabel(hit.meshName);
  _loupe.setPosition(screenX, screenY);
  _loupe.setVisible(true);

  // Linha provisional no State 3 — vai do P1 confirmado até o candidato.
  if (_state === STATE.PLACING_P2) {
    if (_lineId === null) {
      _lineId = _world.addLine(_endpoints[0].point3D, hit.point3D, { provisional: true });
    } else {
      _world.updateLineEnd(_lineId, hit.point3D);
    }
  }

  const label = _state === STATE.PLACING_P1 ? "P1" : "P2";
  _toolbar.showConfirmRow(label);
  // Atualiza hint pra deixar claro que o ponto é arrastável.
  _hint.setText("Arraste o ponto para ajustar, ou toque em outra estrutura");
}

// ---------------------------------------------------------------------------
// Pill offset perpendicular (medições curtas na tela)
// ---------------------------------------------------------------------------

function _applyPillOffsetIfShort() {
  if (_endpoints.length !== 2 || _pillId === null) return;
  const a = _world.projectToScreen(_endpoints[0].point3D);
  const b = _world.projectToScreen(_endpoints[1].point3D);
  const screenLength = Math.hypot(a.x - b.x, a.y - b.y);
  _world.updatePillOffset(_pillId, screenLength < SHORT_LINE_THRESHOLD_PX ? SHORT_LINE_OFFSET_PX : 0);
}
