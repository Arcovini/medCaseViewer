import { classifyFiles, hasExam } from "./classify.js";
import { MIN_SLICES_PER_SERIES, nrrdInfo, readDicomSeries, seriesZip } from "./dicom-series.js";

// Backend auto-detection:
//   localhost / 127.0.0.1 -> local uvicorn on :8000 (dev)
//   anything else         -> Railway (prod)
const BACKEND = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://localhost:8000"
  : "https://mesh-processor-production-c2ea.up.railway.app";

const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
// Exame de imagem: cada série vai num request próprio — a 0 no POST /upload, as
// outras em POST /cases/{uid}/exam —, porque o Railway só espera 5 min pelo
// corpo de um request. Limites espelham o mesh-processor (MAX_EXAM_BYTES por
// request, MAX_EXAM_SERIES por caso). Cada série DICOM viaja como um .zip
// montado aqui (dicom-series.seriesZip), então o limite de arquivos soltos não
// se aplica.
const MAX_EXAM_BYTES = 200 * 1024 * 1024;
const MAX_EXAM_SERIES = 4;
// Espelha exam.MAX_UNZIPPED_BYTES: o servidor recusa um .zip de série cujas
// imagens somem mais que isto descompactadas.
const MAX_UNZIPPED_BYTES = 600 * 1024 * 1024;
const UPLOAD_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_ROTATE_MS = 2500;

const PHASE_UPLOAD = [
  "Recebendo os arquivos...",
  "Simplificando a geometria...",
  "Combinando estruturas em um modelo único...",
  "Aplicando cores às estruturas...",
  "Guardando o modelo...",
];

const $ = (id) => document.getElementById(id);

const sections = {
  idle: $("state-idle"),
  processing: $("state-processing"),
  done: $("state-done"),
  error: $("state-error"),
};

let selectedFiles = [];
// Exame: { series, ignored, include: Set<key>, primary: key } ou null.
// Cada série: { key, kind: "dicom"|"nrrd"|"opaque", description, modality,
// frameOfRef, images, spacing, bytes, problem, ... } (dicom-series.js).
// examError guarda a recusa (mostrada na própria seção); examReading, o
// progresso enquanto os cabeçalhos são lidos.
let exam = null;
let examError = "";
let examReading = null;
let dropError = "";
// Levas de arquivos são processadas uma de cada vez, na ordem (ingestChain),
// e se somam. resetGen: Cancelar descarta a leva em andamento; examSeq:
// Remover o exame descarta a leitura em andamento.
let ingestChain = Promise.resolve();
let resetGen = 0;
let examSeq = 0;
// Conclusão: uma linha por série enviada, com o que é preciso para reenviar.
let done = null;
// Cada isolamento é um par ordenado {principal, secondary} em NOMES DE ARQUIVO
// originais — contrato do form field `boolean_ops`. O backend indexa por nome
// original (processor._apply_boolean_ops), o que tem duas consequências na UI:
// só estruturas originais podem ser referência, e só elas podem ser isoladas
// de novo. A peça amarela não existe naquele índice.
let ops = [];
// Quais pares de arquivos se sobrepõem (overlap-worker.js). Chave: pairKey.
// Valor: true | false | null — null = não deu para saber, e a estrutura
// continua oferecida (o backend decide, como antes). Par ausente enquanto
// overlapDone é false = ainda sendo verificado.
let overlaps = new Map();
let overlapDone = true;
let overlapWorker = null;
let openMenu = null; // {kind: "new"|"ref", key} — filename, ou índice da op
let confirming = false;
let messageTimer = null;

function show(state) {
  for (const [name, el] of Object.entries(sections)) el.hidden = name !== state;
}

const displayName = (filename) => filename.replace(/\.[^.]+$/, "");

// Isolar só existe no caminho STL, com 2+ arquivos: sem uma segunda estrutura
// não há por onde cortar, e o backend recusa o campo fora do caminho STL.
const canIsolate = () =>
  selectedFiles.length >= 2 && selectedFiles.every((f) => /\.stl$/i.test(f.name));

/* ---------------- Modelo de peças ----------------
 * Resolve a lista de peças aplicando as operações NA ORDEM configurada, que é a
 * mesma ordem em que o backend as aplica. Cada operação renomeia a estrutura
 * alvo para "B fora de A" e insere logo depois uma peça nova "B dentro de A".
 * Encadear compõe os nomes ("Tumor fora de Rim dentro de Coluna") porque a
 * referência entra pelo nome CORRENTE, não pelo original.
 *
 * Toda peça carrega a estrutura de origem: é ela que agrupa a lista, e é por
 * isso que encadear não cria um nível novo de indentação — só acrescenta linha
 * ao mesmo grupo.
 */
function resolvePieces() {
  const pieces = selectedFiles.map((f) => ({
    id: f.name,
    origin: f.name,
    name: displayName(f.name),
    size: f.size,
    isolated: false,
  }));

  ops.forEach((op, index) => {
    const ti = pieces.findIndex((p) => p.id === op.secondary);
    const ref = pieces.find((p) => p.id === op.principal);
    if (ti < 0 || !ref) return;
    const target = pieces[ti];
    const base = target.name;
    target.name = `${base} fora de ${ref.name}`;
    pieces.splice(ti + 1, 0, {
      id: `dentro:${index}`,
      origin: target.origin,
      name: `${base} dentro de ${ref.name}`,
      prefix: `${base} dentro de `,
      refName: ref.name,
      isolated: true,
      opIndex: index,
    });
  });

  return pieces;
}

/* ---------------- Sobreposição ----------------
 * Isolar B dentro de A só produz algo se A e B se sobrepõem — senão o backend
 * recusa o par. O worker mede isso nos próprios arquivos assim que são
 * escolhidos, e o menu passa a oferecer só as estruturas que se tocam.
 * Mede-se entre os arquivos ORIGINAIS: ao encadear, "Tumor fora de Rim" herda
 * as sobreposições do Tumor inteiro (aproximação — o backend ainda confere).
 */
const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// true | false | null como em `overlaps`; undefined = ainda verificando.
function overlapStatus(a, b) {
  const key = pairKey(a, b);
  if (overlaps.has(key)) return overlaps.get(key);
  return overlapDone ? null : undefined;
}

function analyzeOverlaps() {
  overlapWorker?.terminate();
  overlapWorker = null;
  overlaps = new Map();
  overlapDone = true;
  if (!canIsolate()) return;

  let worker;
  try {
    worker = new Worker(new URL("./overlap-worker.js", import.meta.url), { type: "module" });
  } catch {
    return; // sem worker: tudo em aberto, menu completo como antes
  }
  overlapWorker = worker;
  overlapDone = false;

  const finish = () => {
    overlapDone = true;
    overlapWorker = null;
    worker.terminate();
  };
  worker.onmessage = ({ data }) => {
    if (worker !== overlapWorker) return; // resposta de uma seleção antiga
    if (data.done) finish();
    else overlaps.set(pairKey(data.a, data.b), data.overlaps);
    renderStructures();
  };
  worker.onerror = () => {
    if (worker !== overlapWorker) return;
    finish();
    renderStructures();
  };
  worker.postMessage({ files: selectedFiles });
}

// Referências possíveis para isolar `targetFile`: as outras estruturas
// originais que se sobrepõem a ela, menos as que já foram usadas nesse mesmo
// alvo (o par repetido não produziria nada e o backend o recusa). `pending`
// marca as que ainda estão sendo verificadas.
function referenceOptions(targetFile, exceptOpIndex = null) {
  const used = new Set(
    ops
      .filter((op, i) => op.secondary === targetFile && i !== exceptOpIndex)
      .map((op) => op.principal),
  );
  const pieces = resolvePieces();
  return selectedFiles
    .map((f) => f.name)
    .filter((n) => n !== targetFile && !used.has(n))
    .map((n) => ({ file: n, status: overlapStatus(targetFile, n) }))
    .filter(({ status }) => status !== false)
    .map(({ file, status }) => ({
      file,
      pending: status === undefined,
      label: pieces.find((p) => p.id === file)?.name ?? displayName(file),
    }));
}

/* ---------------- Render ---------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgIcon(paths, { width = 13, height = 13, strokeWidth = 1.8 } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

const diagram = () => $("tpl-diagram").content.cloneNode(true);

function bar(color) {
  const el = document.createElement("span");
  el.className = "up-bar";
  if (color) el.style.setProperty("--bar-color", color);
  return el;
}

// Menu de referências: só a lista. A explicação mora no cartão de hesitação,
// que aparece antes do clique — quem já abriu o menu está decidido, e a
// ilustração aqui empurrava as opções para longe do polegar.
function buildMenu(targetFile, { opIndex = null, chosen = null } = {}) {
  const menu = document.createElement("div");
  menu.className = "up-menu";

  const caption = document.createElement("span");
  caption.className = "up-menu-caption";
  caption.textContent = opIndex === null ? "Isolar a parte que está dentro de" : "Isolada dentro de";
  menu.appendChild(caption);

  const options = referenceOptions(targetFile, opIndex);
  for (const opt of options.filter((o) => !o.pending)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "up-menu-item";
    if (opt.file === chosen) b.dataset.chosen = "true";
    b.append(bar(null), document.createTextNode(opt.label));
    b.addEventListener("click", () => {
      if (opIndex === null) ops.push({ principal: opt.file, secondary: targetFile });
      else ops[opIndex] = { principal: opt.file, secondary: targetFile };
      openMenu = null;
      renderStructures();
    });
    menu.appendChild(b);
  }
  // Verificação ainda em curso: as confirmadas já aparecem acima e as demais
  // entram sozinhas quando o worker responder (renderStructures mantém o menu).
  if (options.some((o) => o.pending)) {
    const wait = document.createElement("span");
    wait.className = "up-menu-pending";
    wait.setAttribute("role", "status");
    wait.textContent = "Procurando estruturas que se sobrepõem…";
    menu.appendChild(wait);
  }
  return menu;
}

function buildRow(piece, split) {
  const row = document.createElement("li");
  row.className = "up-row";
  row.dataset.isolated = piece.isolated ? "true" : "false";

  const left = document.createElement("span");
  left.className = "up-row-left";
  // Barra neutra para todas: as cores vêm da tabela de keywords do backend, e a
  // peça isolada é um tom mais claro da cor da origem — que esta tela não sabe
  // sem duplicar a tabela. A barra da isolada é a neutra clareada (CSS), o
  // mesmo gesto que o modelo fará com a cor de verdade.
  left.appendChild(bar(null));

  const name = document.createElement("span");
  name.className = "up-row-name";
  if (piece.isolated) {
    // A referência é editável dentro do próprio nome: o rótulo da linha e o
    // rótulo no visualizador são o mesmo texto, e um pedaço dele é o controle.
    name.appendChild(document.createTextNode(piece.prefix));
    const token = document.createElement("button");
    token.type = "button";
    token.className = "up-token";
    token.setAttribute("aria-label", `Trocar a estrutura de referência, hoje ${piece.refName}`);
    token.append(
      document.createTextNode(piece.refName),
      svgIcon(["M6 9l6 6 6-6"], { width: 10, height: 10, strokeWidth: 2.2 }),
    );
    token.addEventListener("click", () => {
      const key = `ref:${piece.opIndex}`;
      openMenu = openMenu?.key === key ? null : { kind: "ref", key, piece };
      renderStructures();
    });
    name.appendChild(token);
  } else {
    name.textContent = piece.name;
  }
  left.appendChild(name);

  if (piece.isolated) {
    const tag = document.createElement("span");
    tag.className = "up-iso-tag";
    tag.textContent = "isolada";
    left.appendChild(tag);
  }

  const right = document.createElement("span");
  right.className = "up-row-right";

  // Peças derivadas não são arquivos: não têm tamanho para mostrar.
  if (!split && piece.size != null) {
    const size = document.createElement("span");
    size.className = "up-file-size";
    size.textContent = `${(piece.size / 1024 / 1024).toFixed(1)} MB`;
    right.appendChild(size);
  }

  if (piece.isolated) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "up-quiet";
    undo.textContent = "Desfazer";
    undo.setAttribute("aria-label", `Desfazer ${piece.name}`);
    undo.addEventListener("click", () => {
      ops.splice(piece.opIndex, 1);
      openMenu = null;
      renderStructures();
    });
    right.appendChild(undo);
  } else if (canIsolate() && referenceOptions(piece.id).length > 0) {
    // Só estruturas originais ganham a ação: o backend indexa por nome
    // original, então a peça amarela não pode ser alvo nem referência.
    const wrap = document.createElement("span");
    wrap.className = "up-hoverwrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "up-rowbtn";
    btn.textContent = "Isolar parte";
    btn.setAttribute("aria-label", `Isolar uma parte de ${piece.name}`);
    btn.addEventListener("click", () => {
      const key = `new:${piece.id}`;
      openMenu = openMenu?.key === key ? null : { kind: "new", key, piece };
      renderStructures();
    });
    wrap.appendChild(btn);

    // Ajuda por hesitação: o cartão só aparece depois de meio segundo parado
    // sobre o botão (transition-delay no CSS), então um clique decidido nunca o
    // vê. Em telas de toque ele nem existe — quem ensina lá é o menu.
    const card = document.createElement("div");
    card.className = "up-hovercard";
    card.setAttribute("aria-hidden", "true");
    card.appendChild(diagram());
    const p = document.createElement("p");
    p.className = "up-hovercard-text";
    p.textContent =
      "A parte que está dentro vira uma estrutura própria, num tom mais claro da mesma cor. O resto continua como estava.";
    card.appendChild(p);
    wrap.appendChild(card);

    right.appendChild(wrap);
  }

  row.append(left, right);

  if (openMenu && openMenu.piece.id === piece.id) {
    row.appendChild(
      openMenu.kind === "ref"
        ? buildMenu(ops[piece.opIndex].secondary, {
            opIndex: piece.opIndex,
            chosen: ops[piece.opIndex].principal,
          })
        : buildMenu(piece.id),
    );
  }
  return row;
}

// Agrupa por estrutura de origem. Um grupo com mais de uma peça ganha o trilho:
// as linhas vieram de um clique só, e "Desfazer" desfaz aquele par.
function renderStructures() {
  const list = $("structure-list");
  list.innerHTML = "";
  list.dataset.overlaps = overlapDone ? "done" : "pending";

  const pieces = resolvePieces();
  const groups = new Map();
  for (const p of pieces) {
    if (!groups.has(p.origin)) groups.set(p.origin, []);
    groups.get(p.origin).push(p);
  }

  for (const rows of groups.values()) {
    const split = rows.length > 1;
    const li = document.createElement("li");
    li.className = "up-group";
    li.dataset.split = split ? "true" : "false";
    const inner = document.createElement("ul");
    inner.className = "up-group-rows";
    for (const piece of rows) inner.appendChild(buildRow(piece, split));
    li.appendChild(inner);
    list.appendChild(li);
  }

  const hasFiles = selectedFiles.length > 0;
  $("structures").hidden = !hasFiles;
  $("btn-cancel").hidden = !(hasFiles || exam || examReading) || confirming;
  $("cancel-confirm").hidden = !confirming;
  renderDrop();

  if (confirming) {
    $("cancel-confirm-text").textContent =
      ops.length === 1
        ? "Descartar 1 parte isolada?"
        : `Descartar ${ops.length} partes isoladas?`;
  }
}

function startRotator(messages) {
  stopRotator();
  let i = 0;
  $("status-message").textContent = messages[0];
  messageTimer = setInterval(() => {
    i = (i + 1) % messages.length;
    $("status-message").textContent = messages[i];
  }, MESSAGE_ROTATE_MS);
}

function stopRotator() {
  if (messageTimer) {
    clearInterval(messageTimer);
    messageTimer = null;
  }
}

function showError(msg) {
  stopRotator();
  $("error-message").textContent = msg;
  show("error");
}

function showDone(data) {
  stopRotator();
  $("viewer-url").value = data.viewer_url;
  $("btn-open").href = data.viewer_url;
  $("done-intro").textContent = data.stats
    ? "O link abaixo abre o modelo 3D no visualizador. Quem receber o link não precisa instalar nada."
    : "O link abaixo abre o exame no visualizador. Quem receber o link não precisa instalar nada.";
  renderDoneSeries();
  show("done");
}

// Linhas da conclusão. done.rows: [{ s, index, state: "ok"|"fail"|"sending"|"skipped", info, error }].
function renderDoneSeries() {
  const box = $("done-exam");
  const rows = done?.rows || [];
  box.hidden = rows.length === 0;
  if (!rows.length) return;
  const ok = rows.filter((r) => r.state === "ok").length;
  $("done-exam-title").textContent = rows.length === 1
    ? "Exame de imagem"
    : `Exame de imagem · ${ok} de ${rows.length} séries incluídas`;
  const list = $("done-series");
  list.innerHTML = "";
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "up-done-row";
    li.dataset.state = r.state;
    li.appendChild(stateIcon(r.state));
    const main = document.createElement("span");
    main.className = "up-done-main";
    const name = document.createElement("span");
    name.className = "up-done-name";
    name.textContent = r.info?.label || seriesName(r.s);
    main.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "up-done-meta";
    if (r.state === "ok" && r.info) {
      const reduced = r.info.downsample?.some((f) => f > 1);
      meta.textContent = `${r.info.shape.join(" × ")} · ${r.info.spacing.map(fmtMm).join(" × ")} mm`
        + (reduced ? " · resolução reduzida para abrir bem no celular" : "");
    } else if (r.state === "sending") {
      meta.textContent = "Enviando de novo…";
    } else if (r.state === "skipped") {
      meta.textContent = "Não enviada: a série usada na segmentação não foi guardada.";
    } else {
      meta.textContent = r.error || "Não foi guardada. O resto do caso já está no link.";
    }
    main.appendChild(meta);
    li.appendChild(main);
    if (r.index === 0 && rows.length > 1 && done.hasModel) {
      const badge = document.createElement("span");
      badge.className = "up-series-badge";
      badge.textContent = "usada na segmentação";
      li.appendChild(badge);
    }
    if (r.state === "fail" && r.index > 0 && done.token) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "up-rowbtn";
      retry.textContent = "Tentar de novo";
      retry.dataset.testid = `retry-series-${r.index}`;
      retry.addEventListener("click", () => retrySeries(r));
      li.appendChild(retry);
    }
    list.appendChild(li);
  }
  $("done-exam-hint").hidden = !rows.some((r) => r.state === "fail");
}

function stateIcon(state) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "up-done-icon");
  const path = (d) => { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); svg.appendChild(p); };
  if (state === "ok") path("M4 12.5l5 5L20 6.5");
  else if (state === "sending") path("M12 3a9 9 0 1 0 9 9");
  else { path("M12 7.5v5.5"); path("M12 16.5v.5"); const c = document.createElementNS(ns, "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "9"); svg.appendChild(c); }
  return svg;
}

async function retrySeries(row) {
  row.state = "sending";
  renderDoneSeries();
  const r = await sendExtraSeries(row.s, row.index, done.uid, done.token);
  Object.assign(row, r);
  renderDoneSeries();
}

const fmtMm = (v) => String(Math.round(v * 100) / 100).replace(".", ",");
const fmtMB = (bytes) => {
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
};

function reset() {
  stopRotator();
  done = null;
  clearSelection();
  clearExam();
  dropError = "";
  renderDrop();
  show("idle");
}

function uploadPhases() {
  const hasModel = selectedFiles.length > 0;
  const phases = [];
  if (sendPlan().length) phases.push("Lendo o exame de imagem...", "Removendo os dados do paciente...");
  if (hasModel) {
    phases.push(PHASE_UPLOAD[1]);
    if (ops.length) phases.push("Dividindo estruturas em dentro e fora...");
    phases.push(...PHASE_UPLOAD.slice(2));
  } else {
    phases.push("Guardando o exame...");
  }
  return phases;
}

// Barra de progresso: `null` = ocupada (o trilho que corre), 0..1 = envio real.
function setProgress(fraction) {
  const bar = $("progress");
  if (fraction == null) {
    bar.dataset.mode = "busy";
    bar.removeAttribute("aria-valuenow");
    bar.style.removeProperty("--p");
  } else {
    bar.dataset.mode = "determinate";
    bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    bar.style.setProperty("--p", `${(fraction * 100).toFixed(1)}%`);
  }
}

function setStatus(text) {
  stopRotator();
  $("status-message").textContent = text;
}

// POST com progresso real do envio (fetch não tem). → { ok, status, body, slow }.
// `slow`: a conexão caiu depois da janela de 5 min do Railway para o corpo.
function postForm(url, form, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const t0 = Date.now();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
    xhr.upload.onload = () => onProgress?.(null, null);
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* corpo não-JSON */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    const fail = () => resolve({ ok: false, status: 0, body: null, slow: Date.now() - t0 > UPLOAD_WINDOW_MS - 20_000 });
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.ontimeout = fail;
    xhr.send(form);
  });
}

function failureText(r, subject) {
  if (r.status === 0) {
    return r.slow
      ? `O envio ${subject} passou de 5 minutos e o servidor encerrou a conexão. Tente de novo numa rede mais rápida.`
      : "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";
  }
  // FastAPI manda `detail` como lista nos erros de validação (422): não é
  // texto para o clínico.
  const d = r.body?.detail;
  return typeof d === "string" && d ? d : `Erro ${r.status} do servidor. Tente de novo.`;
}

// Séries na ordem de envio: a usada na segmentação primeiro (vira a 0).
function sendPlan() {
  if (!exam) return [];
  sanitizeChoice();
  const chosen = exam.series.filter((s) => exam.include.has(s.key));
  chosen.sort((a, b) => (a.key === exam.primary ? -1 : b.key === exam.primary ? 1 : 0));
  return chosen;
}

// O que vai no campo `exam` para uma série: o .nrrd ou o .zip como vieram, ou
// o .zip montado com as imagens da série. Recusa acima do limite do servidor.
async function seriesPayload(s, n, total) {
  if (s.kind === "nrrd" || s.kind === "opaque") return { blob: s.file, name: s.file.name };
  setStatus(`Preparando a série ${n} de ${total}...`);
  setProgress(0);
  const blob = await seriesZip(s, (k) => setProgress(k / s.slices.length));
  if (blob.size > MAX_EXAM_BYTES) {
    throw new Error(`A série ${seriesName(s)} tem ${fmtMB(blob.size)} mesmo compactada e passa do limite de 200 MB por série. Envie uma reconstrução com menos imagens.`);
  }
  return { blob, name: "serie.zip" };
}

function sendingText(label, loaded, total) {
  return `${label} · ${fmtMB(loaded)} de ${fmtMB(total)}`;
}

async function process() {
  const plan = sendPlan();
  if (selectedFiles.length === 0 && plan.length === 0) return;

  const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  if (selectedFiles.length && totalBytes > MAX_TOTAL_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    return showError(
      `Arquivos somam ${mb} MB, excedendo o limite de 60 MB. Tente reduzir ou dividir o caso.`,
    );
  }

  show("processing");
  const total = plan.length;
  let payload = null;
  if (total) {
    try {
      payload = await seriesPayload(plan[0], 1, total);
    } catch (e) {
      return showError(e.message);
    }
  }

  const form = new FormData();
  for (const f of selectedFiles) form.append("files", f);
  if (ops.length) form.append("boolean_ops", JSON.stringify(ops));
  // A série 0 no campo `exam` (repetido como `files`).
  if (payload) form.append("exam", payload.blob, payload.name);

  const label = total === 0 ? "Enviando as estruturas"
    : total === 1 ? (selectedFiles.length ? "Enviando as estruturas e o exame" : "Enviando o exame")
    : selectedFiles.length ? `Enviando as estruturas e a série 1 de ${total}` : `Enviando a série 1 de ${total}`;
  setStatus(label);
  setProgress(0);
  const r = await postForm(`${BACKEND}/upload`, form, (loaded, all) => {
    if (loaded == null) {
      setProgress(null);
      startRotator(uploadPhases());
    } else {
      setProgress(loaded / all);
      $("status-message").textContent = sendingText(label, loaded, all);
    }
  });
  if (!r.ok) return showError(failureText(r, "do caso"));
  const data = r.body;

  done = { uid: data.uid, token: data.write_token, hasModel: selectedFiles.length > 0, rows: [] };
  if (total) {
    const e = data.exam;
    done.rows.push(e?.stored
      ? { s: plan[0], index: 0, state: "ok", info: e }
      : { s: plan[0], index: 0, state: "fail", error: e?.error || "O exame não pôde ser guardado. Envie de novo para incluí-lo." });
  }
  // Séries extras, uma por request. Sem a série 0 guardada não há token (nem
  // série da segmentação para as outras se alinharem).
  for (let i = 1; i < total; i++) {
    if (!data.write_token) {
      done.rows.push({ s: plan[i], index: i, state: "skipped" });
      continue;
    }
    const row = { s: plan[i], index: i };
    Object.assign(row, await sendExtraSeries(plan[i], i, data.uid, data.write_token, total));
    done.rows.push(row);
  }

  // Nada é processado depois da resposta: o modelo e o exame já estão no R2.
  showDone(data);
}

// POST /cases/{uid}/exam de uma série extra. → { state, info?, error? }.
async function sendExtraSeries(s, index, uid, token, total = null) {
  const n = index + 1;
  let payload;
  try {
    payload = total ? await seriesPayload(s, n, total) : await seriesPayloadQuiet(s);
  } catch (e) {
    return { state: "fail", error: e.message };
  }
  const form = new FormData();
  form.append("write_token", token);
  form.append("index", String(index));
  form.append("exam", payload.blob, payload.name);
  const label = total ? `Enviando a série ${n} de ${total}` : null;
  if (label) { setStatus(label); setProgress(0); }
  const r = await postForm(`${BACKEND}/cases/${uid}/exam`, form, (loaded, all) => {
    if (!label) return;
    if (loaded == null) {
      setProgress(null);
      setStatus(`Preparando a série ${n} de ${total} e removendo os dados do paciente...`);
    } else {
      setProgress(loaded / all);
      $("status-message").textContent = sendingText(label, loaded, all);
    }
  });
  if (!r.ok) return { state: "fail", error: failureText(r, "desta série") };
  if (!r.body?.exam) return { state: "fail", error: "Resposta inesperada do servidor. Tente de novo." };
  return { state: "ok", info: r.body.exam, error: null };
}

// Reenvio a partir da conclusão: sem mexer na tela de progresso.
async function seriesPayloadQuiet(s) {
  if (s.kind === "nrrd" || s.kind === "opaque") return { blob: s.file, name: s.file.name };
  const blob = await seriesZip(s);
  if (blob.size > MAX_EXAM_BYTES) throw new Error(`A série passa de 200 MB mesmo compactada.`);
  return { blob, name: "serie.zip" };
}

/* ---------------- Eventos ---------------- */

function clearSelection() {
  selectedFiles = [];
  ops = [];
  openMenu = null;
  confirming = false;
  $("file-input").value = "";
  analyzeOverlaps();
  renderStructures();
}

// Novas estruturas se somam às anteriores ("Adicionar mais arquivos"). Um
// arquivo com o mesmo nome substitui o antigo — e aí os isolamentos, que
// apontam para nomes, recomeçam.
function addStructures(files) {
  const byName = new Map(selectedFiles.map((f) => [f.name, f]));
  let replaced = false;
  for (const f of files) {
    if (byName.has(f.name)) replaced = true;
    byName.set(f.name, f);
  }
  selectedFiles = [...byName.values()];
  if (replaced) ops = [];
  openMenu = null;
  confirming = false;
  analyzeOverlaps();
  renderStructures();
  // A escolha de séries depende de haver estruturas (alinhamento, "usada na
  // segmentação"): revalida.
  renderExam();
}

// Cancelar no canto do cartão: começa o caso de novo.
function clearAll() {
  resetGen++;
  dropError = "";
  clearExam();
  clearSelection();
  renderExam();
}

// Cancelar volta ao início. Só pergunta quando existe algo a perder — confirmar
// um clique que não destrói nada é atrito puro.
$("btn-cancel").addEventListener("click", () => {
  if (ops.length > 0) {
    confirming = true;
    openMenu = null;
    renderStructures();
  } else {
    clearAll();
  }
});
$("btn-cancel-keep").addEventListener("click", () => {
  confirming = false;
  renderStructures();
});
$("btn-cancel-discard").addEventListener("click", clearAll);

$("btn-process").addEventListener("click", () => {
  process().catch((e) => {
    console.error("[upload] falha no envio", e);
    showError("Algo deu errado no envio. Tente de novo.");
  });
});
$("btn-new").addEventListener("click", reset);
$("btn-retry").addEventListener("click", reset);

// Clique fora fecha o menu aberto, como qualquer popover.
document.addEventListener("click", (e) => {
  if (!openMenu) return;
  if (e.target.closest(".up-menu, .up-rowbtn, .up-token")) return;
  openMenu = null;
  renderStructures();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (openMenu) {
    openMenu = null;
    renderStructures();
  } else if (confirming) {
    confirming = false;
    renderStructures();
  }
});

// Copiar o link — mesmo componente e mesmo retorno visual do modal de
// compartilhar do visualizador (main.js copyShareLink).
$("btn-copy").addEventListener("click", async () => {
  const input = $("viewer-url");
  const btn = $("btn-copy");
  const label = btn.querySelector(".link-copy-label");
  try {
    await navigator.clipboard?.writeText(input.value);
  } catch {
    input.removeAttribute("readonly");
    input.select();
    try { document.execCommand("copy"); } catch { /* sem clipboard: o link fica selecionado */ }
    input.setAttribute("readonly", "");
  }
  btn.classList.add("ok");
  const previous = label.textContent;
  label.textContent = "Copiado";
  setTimeout(() => {
    btn.classList.remove("ok");
    label.textContent = previous;
  }, 1600);
});

/* ---------------- Área única: soltar, escolher, separar ----------------
 * Tudo entra por ingest(): classify.js separa estruturas e exame, e o exame
 * tem os cabeçalhos lidos e as séries agrupadas (dicom-series.js). As levas
 * se somam ("Adicionar mais arquivos"): os STLs e depois a pasta do CD, ou a
 * pasta da fase arterial e depois a da venosa. Cancelar começa de novo.
 */

function ingest(files) {
  if (!files.length) return;
  const gen = resetGen;
  ingestChain = ingestChain
    .then(() => (gen === resetGen ? ingestOne(files, gen) : null))
    .catch((e) => {
      console.error("[upload] falha ao ler os arquivos", e);
      dropError = "Não foi possível ler esses arquivos. Tente de novo.";
      examReading = null;
      renderExam();
      renderStructures();
    });
}

async function ingestOne(files, gen) {
  dropError = "";
  // Estruturas chegando: a checagem de sobreposição vai recomeçar. Marcar já,
  // antes do primeiro await, para ninguém ler o "done" da leva anterior.
  if (files.some((f) => /\.(stl|obj)$/i.test(f.name))) $("structure-list").dataset.overlaps = "pending";
  renderDrop();
  const c = await classifyFiles(files);
  if (gen !== resetGen) return;
  if (c.error) {
    dropError = c.error;
    renderStructures(); // devolve o data-overlaps da lista ao estado real
    return;
  }
  if (c.structures.length) addStructures(c.structures);
  if (hasExam(c)) {
    await readExam(c, gen);
  } else if (!c.structures.length) {
    dropError = "Nenhum arquivo de estrutura (STL, OBJ) ou de exame (DICOM, NRRD) encontrado.";
  }
  renderStructures();
}

// Lê as séries da leva e soma às que já estavam (mesma série de novo substitui
// a anterior). A escolha feita continua; se não havia principal, a série
// válida com mais imagens vira a principal.
async function readExam(c, gen) {
  const seq = ++examSeq;
  const alive = () => gen === resetGen && seq === examSeq;
  const sources = [
    ...c.dicom.map((file) => ({ file })),
    ...c.zips.flatMap(({ file, entries }) => entries.map((entry) => ({ zip: file, entry }))),
  ];
  examError = "";
  examReading = { done: 0, total: sources.length };
  renderExam();
  renderStructures();
  const dicom = sources.length
    ? await readDicomSeries(sources, (n, total) => {
      if (!alive()) return;
      examReading = { done: n, total };
      renderExamReading();
    })
    : { series: [], ignored: 0, multiframe: 0, shortest: null };
  if (!alive()) return; // quem descartou a leitura já limpou examReading

  const nrrds = await Promise.all(c.nrrds.map(async (file) => {
    const info = await nrrdInfo(file);
    return {
      key: `nrrd:${file.name}`, kind: "nrrd", file, description: file.name.replace(/\.nrrd$/i, ""),
      modality: null, frameOfRef: null, images: info?.images ?? null, spacing: info?.spacing ?? null,
      bytes: file.size, problem: file.size > MAX_EXAM_BYTES ? "Passa do limite de 200 MB por série." : null,
    };
  }));
  const opaque = c.opaqueZips.map((file) => ({
    key: `zip:${file.name}`, kind: "opaque", file, description: file.name, modality: null,
    frameOfRef: null, images: null, spacing: null, bytes: file.size,
    problem: file.size > MAX_EXAM_BYTES ? "Passa do limite de 200 MB por série." : null,
  }));
  for (const s of dicom.series) {
    if (!s.problem && s.rawBytes > MAX_UNZIPPED_BYTES) {
      s.problem = `Tem ${fmtMB(s.rawBytes)} de imagens; o servidor aceita até 600 MB por série.`;
    }
  }
  if (!alive()) return;
  examReading = null;

  const names = new Set();
  for (const n of nrrds) {
    if (names.has(n.key)) {
      examError = `Dois arquivos se chamam ${n.file.name}. Renomeie um deles e envie de novo.`;
      renderExam();
      renderStructures();
      return;
    }
    names.add(n.key);
  }

  const incoming = [...dicom.series, ...nrrds, ...opaque];
  if (!incoming.length) {
    // As séries que já estavam continuam; a mensagem explica a leva nova.
    examError = dicom.multiframe
      ? "Este exame está no formato DICOM multi-frame (todas as imagens num arquivo só), que ainda não é aceito. Exporte a série como imagens separadas ou como .nrrd (3D Slicer)."
      : dicom.shortest
        ? `A série DICOM tem só ${dicom.shortest} imagem(ns); o mínimo para montar o volume é ${MIN_SLICES_PER_SERIES}.`
        : "Nenhuma imagem DICOM em tons de cinza com posição no paciente foi encontrada nos arquivos do exame.";
    renderExam();
    renderStructures();
    return;
  }
  const kept = exam ? exam.series.filter((s) => !incoming.some((n) => n.key === s.key)) : [];
  const series = [...kept, ...incoming];
  const include = new Set(exam ? [...exam.include].filter((k) => series.some((s) => s.key === k)) : []);
  let primary = exam && include.has(exam.primary) ? exam.primary : null;
  if (!primary) {
    // Principal sugerida (o clínico confirma): a que mais parece ser a da
    // segmentação — axial, cortes mais finos, mais imagens. Só ela vem
    // marcada; as outras o clínico escolhe. "Mais imagens" sozinho escolhia a
    // reconstrução coronal numa TC real do TCIA.
    const best = series.filter((s) => !s.problem).sort(byLikelySegmentation)[0];
    if (best) { primary = best.key; include.add(best.key); }
  }
  exam = {
    series,
    ignored: (exam?.ignored ?? 0) + c.ignored + dicom.ignored,
    include,
    primary,
  };
  renderExam();
  renderStructures();
}

// Axial (normal ~ eixo craniocaudal) primeiro; depois espaçamento menor; depois
// mais imagens. Série sem orientação conhecida (NRRD, .zip opaco) conta como
// axial, sem espaçamento conhecido vai depois das que têm.
function byLikelySegmentation(a, b) {
  const axial = (s) => {
    if (!s.iop) return true;
    const [r0, r1, r2, c0, c1, c2] = s.iop;
    return Math.abs(r0 * c1 - r1 * c0) > 0.9; // componente z da normal
  };
  return (axial(b) - axial(a))
    || ((a.spacing ?? Infinity) - (b.spacing ?? Infinity))
    || ((b.images ?? 0) - (a.images ?? 0));
}

function clearExam() {
  examSeq++; // descarta uma leitura em andamento
  exam = null;
  examError = "";
  examReading = null;
  renderExam();
  renderStructures();
}

const seriesName = (s) => s.description || (s.kind === "dicom" ? "Série sem nome" : s.file?.name || "Série");

function seriesMeta(s) {
  const parts = [];
  if (s.kind === "nrrd") parts.push("NRRD");
  else if (s.kind === "opaque") parts.push(".zip");
  else if (s.modality) parts.push(s.modality === "CT" ? "TC" : s.modality === "MR" ? "RM" : s.modality);
  if (s.images) parts.push(`${s.images} imagens`);
  if (s.spacing) parts.push(`${fmtMm(s.spacing)} mm`);
  parts.push(fmtMB(s.bytes));
  return parts.join(" · ");
}

const hasStructures = () => selectedFiles.length > 0;

// Por que esta série não pode ser marcada (ou null). Com estruturas, uma série
// de outro FrameOfReference não se alinha com elas: fica de fora.
function blockedReason(s) {
  if (s.problem) return s.problem;
  const p = exam.series.find((x) => x.key === exam.primary);
  if (hasStructures() && p && s !== p && p.frameOfRef && s.frameOfRef && s.frameOfRef !== p.frameOfRef) {
    return "Outro exame: não alinha com as estruturas.";
  }
  if (!exam.include.has(s.key) && exam.include.size >= MAX_EXAM_SERIES) {
    return `O caso já tem ${MAX_EXAM_SERIES} séries.`;
  }
  return null;
}

// Marcadas que deixaram de valer (a principal mudou, chegaram estruturas)
// saem da escolha.
function sanitizeChoice() {
  if (!exam) return;
  for (const key of [...exam.include]) {
    const s = exam.series.find((x) => x.key === key);
    // Incluída nunca recebe o motivo "já tem 4": aqui só sobram problema e
    // alinhamento.
    if (blockedReason(s)) exam.include.delete(key);
  }
  if (!exam.include.has(exam.primary)) exam.primary = [...exam.include][0] ?? null;
}

function toggleSeries(s) {
  if (exam.include.has(s.key)) exam.include.delete(s.key);
  else if (!blockedReason(s)) exam.include.add(s.key);
  if (!exam.include.has(exam.primary)) exam.primary = [...exam.include][0] ?? null;
  if (!exam.primary && exam.include.size) exam.primary = [...exam.include][0];
  renderExam();
  renderStructures();
}

function makePrimary(s) {
  exam.primary = s.key;
  exam.include.add(s.key);
  renderExam();
  renderStructures();
}

function renderExamReading() {
  const el = $("exam-reading");
  el.hidden = !examReading;
  if (!examReading) return;
  el.textContent = examReading.total
    ? `Lendo o exame… ${examReading.done} de ${examReading.total} imagens`
    : "Lendo o exame…";
}

function renderExam() {
  const box = $("exam-pick");
  box.hidden = !(exam || examError || examReading);
  renderExamReading();
  $("exam-error").hidden = !examError;
  $("exam-error").textContent = examError;
  const single = exam && exam.series.length === 1;
  const multi = exam && exam.series.length > 1;
  $("exam-chosen").hidden = !single;
  $("exam-multi").hidden = !multi;
  $("exam-count").textContent = multi ? `${exam.series.length} séries` : "";
  $("exam-ignored").hidden = !(exam && exam.ignored);
  if (exam?.ignored) {
    $("exam-ignored").textContent = exam.ignored === 1
      ? "1 arquivo ignorado (localizador, relatório ou arquivo que não é imagem)."
      : `${exam.ignored} arquivos ignorados (localizador, relatório ou arquivos que não são imagem).`;
  }
  if (!exam) return;
  sanitizeChoice();

  if (single) {
    const s = exam.series[0];
    $("exam-summary").textContent = s.problem
      ? `${seriesName(s)} · ${s.problem}`
      : `${seriesName(s)} · ${seriesMeta(s)}`;
    $("exam-chosen").dataset.problem = s.problem ? "true" : "false";
    return;
  }

  $("exam-question").textContent = hasStructures()
    ? "Quais séries entram no caso? Marque também a que foi usada na segmentação: as estruturas se alinham a ela."
    : "Quais séries entram no caso? A marcada como “abre primeiro” é a que o visualizador mostra ao abrir.";
  const list = $("exam-series");
  list.innerHTML = "";
  exam.series.forEach((s, i) => {
    const on = exam.include.has(s.key);
    const why = blockedReason(s);
    const li = document.createElement("li");
    li.className = "up-series-row";
    li.dataset.on = String(on);
    li.dataset.blocked = String(!!why && !on);
    const id = `serie-${i}`;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = on;
    box.disabled = !!why && !on;
    box.dataset.testid = `series-check-${i}`;
    box.addEventListener("change", () => toggleSeries(s));
    const label = document.createElement("label");
    label.htmlFor = id;
    label.className = "up-series-main";
    const name = document.createElement("span");
    name.className = "up-series-name";
    name.textContent = seriesName(s); // texto livre do DICOM: nunca HTML
    const meta = document.createElement("span");
    meta.className = "up-series-meta";
    meta.textContent = seriesMeta(s);
    label.append(name, meta);
    if (why && !on) {
      const reason = document.createElement("span");
      reason.className = "up-series-reason";
      reason.textContent = why;
      label.appendChild(reason);
    }
    // Marca e botão numa linha própria, fora do <label> (um botão dentro dele
    // também marcaria a caixa) e embaixo do nome, que não pode ser espremido.
    const body = document.createElement("div");
    body.className = "up-series-body";
    body.appendChild(label);
    li.append(box, body);
    if (on && s.key === exam.primary) {
      const badge = document.createElement("span");
      badge.className = "up-series-badge";
      badge.textContent = hasStructures() ? "usada na segmentação" : "abre primeiro";
      badge.dataset.testid = `series-primary-${i}`;
      body.appendChild(badge);
    } else if (on) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "up-rowbtn up-series-make";
      b.textContent = hasStructures() ? "Foi esta" : "Abrir primeiro";
      b.setAttribute("aria-label", hasStructures()
        ? `Marcar ${seriesName(s)} como a série usada na segmentação`
        : `Abrir ${seriesName(s)} primeiro no visualizador`);
      b.dataset.testid = `series-make-primary-${i}`;
      b.addEventListener("click", () => makePrimary(s));
      body.appendChild(b);
    }
    list.appendChild(li);
  });
  const n = exam.include.size;
  $("exam-send").textContent = n === 0
    ? (hasStructures() ? "Nenhuma série marcada: o caso vai só com as estruturas." : "Marque ao menos uma série.")
    : n === 1 ? "Vai enviar 1 série." : `Vai enviar ${n} séries, uma por vez.`;
}

const examReady = () => !!(exam && exam.include.size && !examReading);

function renderDrop() {
  const compact = hasStructures() || !!exam || !!examReading;
  $("drop").dataset.compact = String(compact);
  $("drop").classList.toggle("up-drop-sm", compact);
  $("drop-error").hidden = !dropError;
  $("drop-error").textContent = dropError;
  $("btn-process").disabled = !!examReading || !(hasStructures() || examReady());
}

$("file-input").addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  e.target.value = "";
  ingest(files);
});
$("folder-input").addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  e.target.value = "";
  ingest(files);
});
$("exam-clear").addEventListener("click", clearExam);
$("exam-clear-multi").addEventListener("click", clearExam);

// "Escolher uma pasta" só onde o seletor de pastas existe de verdade (desktop).
if ("webkitdirectory" in document.createElement("input") && matchMedia("(pointer: fine)").matches) {
  $("folder-btn").hidden = false;
  $("folder-btn").addEventListener("click", () => $("folder-input").click());
}

// Soltar arquivos ou pastas. O input nativo não traz o conteúdo de uma pasta
// solta, então o soltar é nosso: as entradas precisam ser pegas durante o
// evento (antes de qualquer await); ler os arquivos pode vir depois.
// readEntries devolve em lotes (100 no Chrome): repete até vir vazio.
const dropzone = $("drop");
const setDragging = (on) => { dropzone.dataset.drag = on ? "true" : "false"; };
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); setDragging(true); });
dropzone.addEventListener("dragenter", () => setDragging(true));
dropzone.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) setDragging(false);
});
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  setDragging(false);
  const entries = [...(e.dataTransfer?.items || [])]
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);
  const loose = [...(e.dataTransfer?.files || [])];
  if (!entries.length) return ingest(loose);
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  try {
    for (const entry of entries) await walk(entry);
    ingest(out);
  } catch {
    ingest(loose);
  }
});

// Estado inicial: área vazia, sem estruturas nem exame.
renderStructures();
renderExam();

// Ganchos de teste (Playwright), como os do visualizador.
window.__upload = {
  getExam: () => exam && {
    series: exam.series.map((s) => ({ key: s.key, name: seriesName(s), images: s.images, problem: s.problem, blocked: blockedReason(s) })),
    include: [...exam.include],
    primary: exam.primary,
  },
  getStructures: () => selectedFiles.map((f) => f.name),
  isReading: () => !!examReading,
};
