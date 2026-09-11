// case/contour.js
// Máquina de estado da ferramenta Cortar: o médico desenha um contorno sobre o
// modelo e corta a parte das estruturas que ficou dentro (ou fora) dele. O
// corte fecha a abertura — a malha continua fechada (ver world.js). Mesma
// forma de volume.js / measurement.js: estado em módulo, DOM via dom.js, cena
// via world.js. Vale só nesta tela: nada é salvo, e recarregar a página volta
// ao modelo completo.
//
// Fluxo: Cortar na barra → desenhar (arrastar) → soltar fecha o contorno →
// cartão lista só as estruturas visíveis que o contorno cruzou, com prévia do
// que sai → Cortar → aviso com Desfazer. Desfazer também fica na barra.

import { appendPoint, polygonArea, polygonBounds, makeInsideTest, pathData, tidyLoop, dropCollinear } from "./contour-geom.js";

const STATE = Object.freeze({
  IDLE: "idle",
  ARMED: "armed",         // ferramenta ativa, esperando o arraste
  DRAWING: "drawing",     // dedo/mouse pressionado, traçando
  CHOOSING: "choosing",   // contorno fechado, cartão aberto com prévia
});

// Menos que isso é um clique ou um risco, não um contorno (~30×30 px).
const MIN_AREA_PX = 900;

const HINT_ARMED = "Contorne a região que será cortada";
const HINT_ARMED_TOUCH = "Contorne a região com um dedo · dois dedos giram e aproximam";

let _world = null;
let _hint = null;
let _labelFor = (name) => name;
let _onStateChange = () => {};
let _onHistoryChange = () => {};
let _layer = null;
let _card = null;
let _toolbar = null;
let _toast = null;
let _canvas = null;
let _loupe = null;
let _touchNav = false;       // aparelho de toque: dois dedos navegam durante o corte
const _touches = new Set();  // dedos na tela agora
let _navigating = false;     // gesto de dois dedos em andamento

let _state = STATE.IDLE;
let _busy = false;      // corte exato rodando (Manifold)
let _points = [];
let _pointerId = null;
let _candidates = [];   // { name, label, color, flags, insideCount, triCount, checked }
let _side = "inside";
const _history = [];    // [{ entries: [{ name, token }] }], um item por corte confirmado

export function init({ world, dom, hint, labelFor, onStateChange, onHistoryChange }) {
  _world = world;
  _hint = hint;
  if (labelFor) _labelFor = labelFor;
  if (onStateChange) _onStateChange = onStateChange;
  if (onHistoryChange) _onHistoryChange = onHistoryChange;

  _layer = dom.mountContourLayer();
  _card = dom.mountContourCard({
    onToggle: _onToggle,
    onSide: _onSide,
    onCancel: cancel,
    onApply: _apply,
  });
  _toolbar = dom.mountContourToolbar({ onCancel: cancel });
  _toast = dom.mountToast();
  _loupe = dom.mountLoupe();
  world.attachLoupeCanvas(_loupe.canvas);

  _canvas = document.getElementById("canvas");
  _canvas.addEventListener("pointerdown", _onPointerDown);
  _canvas.addEventListener("pointermove", _onPointerMove);
  _canvas.addEventListener("pointerup", _onPointerUp);
  _canvas.addEventListener("pointercancel", _onPointerCancel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _state !== STATE.IDLE) cancel();
  });
  // O traço está em coordenadas de tela: se a janela muda de tamanho ou a
  // câmera mexe (dois dedos, pinça do trackpad, roda), o contorno deixa de
  // coincidir com o modelo e é descartado.
  const discardIfStale = () => {
    if (!_busy && (_state === STATE.DRAWING || _state === STATE.CHOOSING)) _arm(_armedHint());
  };
  window.addEventListener("resize", discardIfStale);
  world.onCameraChange(discardIfStale);

  return {
    start,
    cancel,
    toggle,
    undo,
    hideToast: () => _toast.hide(),
    getState: () => _state,
    isActive: () => _state !== STATE.IDLE,
    isBusy: () => _busy,
    getCandidates: () => _candidates.map(({ name, insideCount, triCount, checked }) => ({ name, insideCount, triCount, checked })),
    getHistoryLength: () => _history.length,
  };
}

function start() {
  if (_state !== STATE.IDLE) return;
  _toast.hide();
  _touches.clear();
  _navigating = false;
  // Arrastar passa a desenhar em vez de girar o modelo. No mouse a câmera
  // fica parada o modo inteiro (o contorno é em coordenadas de tela); no
  // toque, dois dedos ainda giram e aproximam — e descartam o traço em curso.
  _touchNav = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  // Um giro que ainda desacelera moveria a câmera depois do traço.
  _world.stopCameraInertia();
  if (_touchNav) _world.setContourTouchNavigation(true);
  else _world.setControlsEnabled(false);
  _arm(_armedHint());
  _onStateChange(true);
}

function _armedHint() {
  return _touchNav ? HINT_ARMED_TOUCH : HINT_ARMED;
}

function toggle() {
  if (_state === STATE.IDLE) start();
  else cancel();
}

function cancel() {
  if (_state === STATE.IDLE || _busy) return;
  _clearPreviews();
  _reset();
}

// Volta a esperar um novo arraste, descartando o contorno atual.
function _arm(text) {
  _hideLoupe();
  _clearPreviews();
  _state = STATE.ARMED;
  _points = [];
  _pointerId = null;
  _layer.clear();
  _card.hide();
  _toolbar.show();
  _hint.setText(text);
}

// `applied`: saiu porque cortou (e não por Cancelar/Esc).
function _reset(applied = false) {
  _hideLoupe();
  _candidates = [];
  _points = [];
  _pointerId = null;
  _layer.clear();
  _card.hide();
  _toolbar.hide();
  _hint.clear();
  _state = STATE.IDLE;
  if (_touchNav) _world.setContourTouchNavigation(false);
  _touchNav = false;
  _world.setControlsEnabled(true);
  _onStateChange(false, { applied });
}

function _clearPreviews() {
  for (const c of _candidates) _world.clearMeshCutPreview(c.name);
  _candidates = [];
}

// ---------- desenho ----------

// O traço fica preso ao canvas: arrastar para cima do painel não desenha
// por cima dele.
function _clampToCanvas(x, y) {
  const r = _canvas.getBoundingClientRect();
  return [Math.min(Math.max(x, r.left), r.right), Math.min(Math.max(y, r.top), r.bottom)];
}

function _onPointerDown(e) {
  if (e.pointerType === "touch") {
    _touches.add(e.pointerId);
    // Segundo dedo na tela: é navegação (girar/aproximar), não desenho — só
    // onde a navegação por toque está ligada (em aparelho híbrido, com mouse
    // como ponteiro principal, o segundo dedo é só ignorado).
    if (_touches.size >= 2 && _touchNav) {
      _startNavigation();
      return;
    }
  }
  if (_busy || _navigating) return;
  if (_state !== STATE.ARMED && _state !== STATE.CHOOSING) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  // Com o cartão aberto, um novo arraste redesenha: o contorno anterior sai.
  if (_state === STATE.CHOOSING) {
    _clearPreviews();
    _card.hide();
  }
  _state = STATE.DRAWING;
  _pointerId = e.pointerId;
  try { _canvas.setPointerCapture(e.pointerId); } catch (_) { /* navegador sem suporte */ }
  _points = [_clampToCanvas(e.clientX, e.clientY)];
  _toolbar.show();
  _hint.setText("Solte para fechar o contorno");
  _layer.draw(pathData(_points, false), false);
  // O dedo cobre o traço: a lupa acima dele mostra por onde a linha passa.
  if (e.pointerType === "touch") _showLoupe(e.clientX, e.clientY);
}

function _onPointerMove(e) {
  if (_state !== STATE.DRAWING || e.pointerId !== _pointerId) return;
  const [x, y] = _clampToCanvas(e.clientX, e.clientY);
  if (appendPoint(_points, x, y)) _layer.draw(pathData(_points, false), false);
  if (e.pointerType === "touch") _moveLoupe(x, y);
}

function _onPointerUp(e) {
  _releaseTouch(e);
  if (_state !== STATE.DRAWING || e.pointerId !== _pointerId) return;
  const [x, y] = _clampToCanvas(e.clientX, e.clientY);
  appendPoint(_points, x, y);
  _hideLoupe();
  _close();
}

function _onPointerCancel(e) {
  _releaseTouch(e);
  if (_state !== STATE.DRAWING || e.pointerId !== _pointerId) return;
  _arm(_armedHint());
}

function _releaseTouch(e) {
  if (e.pointerType !== "touch") return;
  _touches.delete(e.pointerId);
  if (_touches.size === 0) _navigating = false;
}

// Dois dedos: descarta o traço (ou a escolha) em curso e deixa a câmera
// girar e aproximar. O contorno é em coordenadas de tela, então não
// sobrevive a uma mudança de vista.
function _startNavigation() {
  _navigating = true;
  if (_busy) return;
  if (_state === STATE.DRAWING || _state === STATE.CHOOSING) _arm(_armedHint());
}

// ---------- lupa (só no toque) ----------

function _showLoupe(x, y) {
  const p = _world.pointUnderScreen(x, y);
  if (!p) return;
  _world.openLoupe({ point3D: p });
  _loupe.setLabel(null);
  _loupe.setPosition(x, y);
  _loupe.setVisible(true);
}

function _moveLoupe(x, y) {
  const p = _world.pointUnderScreen(x, y);
  if (p) _world.updateLoupe({ point3D: p });
  _loupe.setPosition(x, y);
}

function _hideLoupe() {
  if (!_loupe) return;
  _world.closeLoupe();
  _loupe.setVisible(false);
}

// Fecha o contorno e descobre quais estruturas visíveis ele cruza.
function _close() {
  _pointerId = null;
  const tooSmall = "Contorno pequeno demais. Desenhe ao redor da região";
  if (_points.length < 3) {
    _arm(tooSmall);
    return;
  }
  // O cruzamento vem antes da área: num oito os dois laços giram em sentidos
  // opostos, a área com sinal se anula e o traço leria como "pequeno demais".
  const loop = tidyLoop(_points);
  if (!loop) {
    _arm("O contorno se cruzou. Desenhe uma volta só, sem cruzar o traço");
    return;
  }
  _points = dropCollinear(loop);
  if (_points.length < 3 || polygonArea(_points) < MIN_AREA_PX) {
    _arm(tooSmall);
    return;
  }

  const inside = makeInsideTest(_points);
  const found = [];
  for (const name of _world.getMeshNames()) {
    const r = _world.classifyMeshTrianglesOnScreen(name, inside);
    if (!r || r.insideCount === 0) continue;
    found.push({
      name,
      label: _labelFor(name),
      color: _world.getMeshColor(name),
      ...r,
      checked: true,
    });
  }
  if (found.length === 0) {
    _arm("O contorno não passou por nenhuma estrutura visível. Desenhe de novo");
    return;
  }

  _candidates = found;
  _side = "inside";
  _state = STATE.CHOOSING;
  _layer.draw(pathData(_points, true), true);
  _toolbar.hide();
  _card.show({ candidates: _candidates, bounds: polygonBounds(_points), side: _side });
  _refresh();
}

// ---------- escolha e prévia ----------

function _removedCount(c) {
  return _side === "inside" ? c.insideCount : c.triCount - c.insideCount;
}

// Triângulos que saem na prévia, na ordem que o world devolveu. "Fora" é o
// complemento.
function _removeFlags(c) {
  if (_side === "inside") return c.flags;
  const out = new Uint8Array(c.flags.length);
  for (let i = 0; i < out.length; i++) out[i] = c.flags[i] ? 0 : 1;
  return out;
}

// Estrutura ocultada depois de fechar o contorno também fica protegida.
function _chosen() {
  return _candidates.filter((c) =>
    c.checked && _removedCount(c) > 0 && _world.getMeshVisibility(c.name) !== false);
}

function _refresh() {
  for (const c of _candidates) {
    if (c.checked && _removedCount(c) > 0) _world.previewMeshCut(c.name, _removeFlags(c));
    else _world.clearMeshCutPreview(c.name);
  }
  const chosen = _chosen();
  _card.setApplyEnabled(chosen.length > 0);
  if (chosen.length > 0) {
    const where = _side === "inside" ? "dentro" : "fora";
    // Muitas estruturas (o fígado tem 13) viram uma contagem: a lista já
    // está no cartão, e a dica precisa caber em uma ou duas linhas.
    const what = chosen.length > 3 ? `${chosen.length} estruturas` : _join(chosen.map((c) => c.label));
    _hint.setText(`O corte remove a parte de ${what} ${where} do contorno`);
  } else if (_candidates.some((c) => c.checked)) {
    _hint.setText("Nada fica fora do contorno nessas estruturas");
  } else {
    _hint.setText("Marque ao menos uma estrutura");
  }
}

function _onToggle(name, checked) {
  const c = _candidates.find((x) => x.name === name);
  if (!c) return;
  c.checked = checked;
  _refresh();
}

function _onSide(side) {
  _side = side === "outside" ? "outside" : "inside";
  _refresh();
}

// Corte exato: um prisma pelo contorno e uma operação booleana por estrutura
// marcada. Leva de frações de segundo a alguns segundos (a primeira vez
// inclui baixar o motor de corte).
async function _apply() {
  if (_state !== STATE.CHOOSING || _busy) return;
  const chosen = _chosen();
  if (chosen.length === 0) return;

  // O prisma sai da câmera de agora — a mesma da prévia —, antes de qualquer
  // espera em que um gesto pudesse mexer nela.
  let cutter = null;
  try {
    cutter = _world.createCutter(_points);
  } catch (err) {
    console.error("[cortar] contorno", err);
  }

  _busy = true;
  _card.setBusy(true);
  _hint.setText("Cortando…");
  for (const c of _candidates) _world.clearMeshCutPreview(c.name);
  // Deixa a dica e o cartão pintarem antes do trabalho pesado.
  await new Promise((r) => setTimeout(r, 30));

  const entries = [];
  const failed = [];
  for (const c of chosen) {
    try {
      if (!cutter) throw new Error("sem prisma de corte");
      const token = await _world.applyMeshCut(c.name, cutter, _side);
      if (token) entries.push({ name: c.name, token });
    } catch (err) {
      console.error("[cortar]", c.name, err);
      failed.push(c.label);
    }
  }

  _busy = false;
  _card.setBusy(false);
  if (entries.length) _history.push({ entries });
  // A prévia já foi limpa; _reset não deve tentar de novo.
  _candidates = [];
  _reset(entries.length > 0);

  // Mais de três nomes viram contagem, como na dica: o aviso é uma linha só.
  const names = (list) => (list.length > 3 ? `${list.length} estruturas` : _join(list));
  const done = entries.map((e) => _labelFor(e.name));
  let msg;
  if (done.length && failed.length) msg = `Corte aplicado em ${names(done)}. Não foi possível cortar ${names(failed)}`;
  else if (done.length) msg = `Corte aplicado em ${names(done)}`;
  else msg = `Não foi possível cortar ${names(failed)}. Tente outro contorno`;
  _toast.show(msg, done.length ? { onAction: undo } : {});
  _notifyHistory();
}

// ---------- desfazer ----------

function undo() {
  if (_busy) return;
  // No meio de um traço ou de uma escolha, desfazer descarta esse contorno e
  // continua no modo (a barra do modo no celular tem Desfazer).
  if (_state === STATE.DRAWING || _state === STATE.CHOOSING) _arm(_armedHint());
  const op = _history.pop();
  if (!op) return;
  for (const { name, token } of [...op.entries].reverse()) _world.restoreMeshGeometry(name, token);
  _toast.hide();
  _notifyHistory();
}

function _notifyHistory() {
  const cutNames = new Set(_history.flatMap((op) => op.entries.map((e) => e.name)));
  _onHistoryChange({ canUndo: _history.length > 0, cutNames, count: _history.length });
}

// "A", "A e B", "A, B e C"
function _join(list) {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}
