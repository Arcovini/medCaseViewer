// Backend auto-detection:
//   localhost / 127.0.0.1 -> local uvicorn on :8000 (dev)
//   anything else         -> Railway (prod)
const BACKEND = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://localhost:8000"
  : "https://mesh-processor-production-c2ea.up.railway.app";

const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const POLL_INTERVAL_MS = 3000;
const LONG_WAIT_MS = 60_000;
const MESSAGE_ROTATE_MS = 2500;

const PHASE_UPLOAD = [
  "Recebendo os arquivos...",
  "Simplificando a geometria...",
  "Combinando estruturas em um modelo único...",
  "Aplicando cores às estruturas...",
  "Enviando para o Sketchfab...",
];

const PHASE_POLL = [
  "Estamos processando...",
  "Preparando a visualização...",
  "Quase pronto...",
];

const $ = (id) => document.getElementById(id);

const sections = {
  idle: $("state-idle"),
  processing: $("state-processing"),
  done: $("state-done"),
  error: $("state-error"),
};

let selectedFiles = [];
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
let longWaitTimer = null;
let pollTimer = null;

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
  $("pick-files").hidden = hasFiles;
  $("structures").hidden = !hasFiles;
  $("btn-cancel").hidden = !hasFiles || confirming;
  $("cancel-confirm").hidden = !confirming;
  $("btn-process").disabled = !hasFiles;

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

function resetTimers() {
  stopRotator();
  if (longWaitTimer) {
    clearTimeout(longWaitTimer);
    longWaitTimer = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  $("status-hint").hidden = true;
}

function showError(msg) {
  resetTimers();
  $("error-message").textContent = msg;
  show("error");
}

function showDone(data) {
  resetTimers();
  $("viewer-url").value = data.viewer_url;
  $("btn-open").href = data.viewer_url;
  show("done");
}

function reset() {
  resetTimers();
  clearSelection();
  show("idle");
}

async function pollStatus(initial) {
  try {
    const r = await fetch(`${BACKEND}/status/${initial.uid}`);
    if (r.ok) {
      const s = await r.json();
      if (s.ready) return showDone(initial);
      if (s.error) return showError(`Erro no processamento: ${s.error}`);
    }
  } catch (e) {
    // Transient network flake — retry on next tick.
  }
  pollTimer = setTimeout(() => pollStatus(initial), POLL_INTERVAL_MS);
}

async function process() {
  if (selectedFiles.length === 0) return;

  const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    return showError(
      `Arquivos somam ${mb} MB, excedendo o limite de 60 MB. Tente reduzir ou dividir o caso.`,
    );
  }

  show("processing");
  startRotator(
    ops.length
      ? [
          ...PHASE_UPLOAD.slice(0, 2),
          "Dividindo estruturas em dentro e fora...",
          ...PHASE_UPLOAD.slice(2),
        ]
      : PHASE_UPLOAD,
  );

  const form = new FormData();
  for (const f of selectedFiles) form.append("files", f);
  if (ops.length) form.append("boolean_ops", JSON.stringify(ops));

  let resp;
  try {
    resp = await fetch(`${BACKEND}/upload`, { method: "POST", body: form });
  } catch (e) {
    return showError(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    );
  }

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.json()).detail || "";
    } catch {
      /* noop */
    }
    return showError(detail || `Erro ${resp.status} do servidor.`);
  }

  const data = await resp.json();

  // Upload accepted; Sketchfab processing is async — poll.
  startRotator(PHASE_POLL);
  longWaitTimer = setTimeout(() => {
    $("status-hint").hidden = false;
  }, LONG_WAIT_MS);
  pollStatus(data);
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

$("file-input").addEventListener("change", (e) => {
  selectedFiles = Array.from(e.target.files);
  // Trocar os arquivos invalida os isolamentos: eles apontam para nomes que
  // podem não existir mais.
  ops = [];
  openMenu = null;
  confirming = false;
  analyzeOverlaps();
  renderStructures();
});

// Cancelar volta ao início. Só pergunta quando existe algo a perder — confirmar
// um clique que não destrói nada é atrito puro.
$("btn-cancel").addEventListener("click", () => {
  if (ops.length > 0) {
    confirming = true;
    openMenu = null;
    renderStructures();
  } else {
    clearSelection();
  }
});
$("btn-cancel-keep").addEventListener("click", () => {
  confirming = false;
  renderStructures();
});
$("btn-cancel-discard").addEventListener("click", clearSelection);

$("btn-process").addEventListener("click", process);
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

/* ---------------- Arrastar e soltar ----------------
 * O <input type=file> cobre a área toda e já aceita o drop nativamente (ele
 * dispara change sozinho). Aqui só pintamos o estado de arraste — e cancelamos
 * o dragover, sem o qual o navegador abriria o arquivo numa nova aba.
 */
const dropzone = document.querySelector(".up-drop");
const setDragging = (on) => { dropzone.dataset.drag = on ? "true" : "false"; };

dropzone.addEventListener("dragover", (e) => { e.preventDefault(); setDragging(true); });
dropzone.addEventListener("dragenter", () => setDragging(true));
dropzone.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) setDragging(false);
});
dropzone.addEventListener("drop", () => setDragging(false));

// Estado inicial: dropzone, sem estruturas.
renderStructures();
