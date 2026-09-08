import { initTheme, toggleTheme } from "../theme.js";

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
let boolOps = []; // [{principal: filename, secondary: filename}] — ver seção abaixo
let step = "files"; // "files" | "divide"
let messageTimer = null;
let longWaitTimer = null;
let pollTimer = null;

function show(state) {
  for (const [name, el] of Object.entries(sections)) el.hidden = name !== state;
}

/* ---------------- Passos ----------------
 * Passo 1 escolhe os arquivos, passo 2 configura as divisões. É só navegação de
 * tela: o envio continua sendo UM único POST /upload no fim, com os arquivos e
 * o campo boolean_ops juntos. O backend é stateless (sem sessão nem banco), e
 * subir os arquivos já no passo 1 exigiria estado no servidor.
 *
 * O passo 2 só existe quando há o que dividir (2+ STLs). Num arquivo único ou
 * num bundle OBJ o fluxo é de uma tela só, como antes.
 */

// O passo corrente é marcado só por aria-current; o CSS pinta a partir dele.
// Sem estado duplicado entre atributo de acessibilidade e classe visual.
function paintStepChip(chipId, active) {
  $(chipId).setAttribute("aria-current", active ? "step" : "false");
}

function renderStep() {
  const dividable = boolAvailable();
  const onDivide = step === "divide" && dividable;

  $("stepper").hidden = !dividable;
  $("step-files").hidden = onDivide;
  $("intro-files").hidden = onDivide;
  $("bool-section").hidden = !onDivide;

  paintStepChip("step-1-chip", !onDivide);
  paintStepChip("step-2-chip", onDivide);

  // Passo 1 com divisão possível avança; sem divisão possível processa direto,
  // para não impor um passo vazio a quem envia um arquivo só ou um OBJ.
  const showContinue = !onDivide && dividable;
  $("btn-continue").hidden = !showContinue;
  $("btn-continue").disabled = selectedFiles.length === 0;
  $("btn-process").hidden = showContinue;
  $("btn-back").hidden = !onDivide;
}

function goToStep(next) {
  step = next;
  renderStep();
  renderBoolSection();
  // A tela troca de conteúdo: sem isto o clínico cai no meio do passo novo.
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFileList() {
  const list = $("file-list");
  list.innerHTML = "";
  for (const f of selectedFiles) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = f.name;
    name.className = "up-file-name";
    const size = document.createElement("span");
    size.textContent = `${(f.size / 1024).toFixed(1)} KB`;
    size.className = "up-file-size";
    li.append(name, size);
    list.appendChild(li);
  }
  renderBoolSection(); // também atualiza o estado dos botões do rodapé
}

/* ---------------- Divisão de estruturas (dentro/fora) ----------------
 * Cada divisão é um par ordenado {principal, secondary} (filenames originais,
 * enviados no form field `boolean_ops` — o nome do campo é contrato de API).
 * Semântica aplicada pelo backend: a referência (principal) fica inteira e a
 * estrutura a dividir (secondary) é separada em "B fora de A" e "B dentro de A",
 * esta última destacada em amarelo no visualizador.
 * Disponível apenas quando a seleção é 2+ arquivos, todos STL.
 */

const boolAvailable = () =>
  selectedFiles.length >= 2 && selectedFiles.every((f) => /\.stl$/i.test(f.name));

const displayName = (filename) => filename.replace(/\.[^.]+$/, "");

// Separador NUL, não um espaço: nomes de arquivo podem conter espaços e um
// espaço faria o par ("a b.stl","c.stl") colidir com ("a.stl","b c.stl").
const opKey = (op) => `${op.principal}\u0000${op.secondary}`;

function hasDuplicateBoolOps() {
  const seen = new Set();
  for (const op of boolOps) {
    if (seen.has(opKey(op))) return true;
    seen.add(opKey(op));
  }
  return false;
}

function updateProcessState() {
  const duplicated = hasDuplicateBoolOps();
  $("btn-process").disabled = selectedFiles.length === 0 || duplicated;
  $("bool-warning").hidden = !duplicated;
}

function firstUnusedPair() {
  const names = selectedFiles.map((f) => f.name);
  const used = new Set(boolOps.map(opKey));
  for (const p of names)
    for (const s of names)
      if (p !== s && !used.has(`${p}\u0000${s}`)) return { principal: p, secondary: s };
  return null;
}

// Nomes finais de cada peça, na ordem em que o backend aplica as divisões
// (processor._apply_boolean_ops). Divisões encadeadas compõem: dividir o tumor
// pelo rim e depois pela coluna dá "Tumor fora de Rim fora de Coluna", não
// "Tumor fora de Coluna" — por isso a prévia acompanha o nome corrente de cada
// estrutura em vez de usar o nome do arquivo.
//
// Previsão de melhor caso: se a peça de fora sair vazia (a estrutura está toda
// dentro da referência) o backend a descarta e só a peça de dentro permanece.
// Isso depende da geometria, que a tela não conhece.
function previewNames(ops) {
  const atual = {};
  for (const f of selectedFiles) atual[f.name] = displayName(f.name);
  return ops.map((op) => {
    const a = atual[op.principal] ?? displayName(op.principal);
    const b = atual[op.secondary] ?? displayName(op.secondary);
    const fora = `${b} fora de ${a}`;
    atual[op.secondary] = fora;
    return { a, b, fora, dentro: `${b} dentro de ${a}` };
  });
}

// Monta a lista de divisões. Quem decide a visibilidade da seção é renderStep;
// aqui só cuidamos do conteúdo e do estado dos botões.
function renderBoolSection() {
  if (!boolAvailable()) {
    boolOps = [];
    // Seleção deixou de ser divisível (ex.: trocou os STLs por um OBJ) enquanto
    // o passo 2 estava aberto: volta para os arquivos em vez de travar numa
    // tela sem sentido.
    if (step === "divide") step = "files";
    renderStep();
    updateProcessState();
    return;
  }
  // Reconciliação: a seleção de arquivos mudou, descarta divisões órfãs.
  const names = selectedFiles.map((f) => f.name);
  boolOps = boolOps.filter(
    (op) => names.includes(op.principal) && names.includes(op.secondary),
  );
  renderStep();

  const counts = {};
  for (const op of boolOps) counts[opKey(op)] = (counts[opKey(op)] || 0) + 1;

  const previews = previewNames(boolOps);
  const list = $("bool-list");
  list.innerHTML = "";
  boolOps.forEach((op, i) => {
    list.appendChild(buildBoolCard(op, i, counts[opKey(op)] > 1, previews[i]));
  });
  // Vazio: o botão é o convite a configurar. Com divisões já criadas, ele passa
  // a ser "adicionar outra".
  $("btn-add-bool-label").textContent = boolOps.length
    ? "Adicionar outra divisão"
    : "Escolher estruturas para dividir";
  $("btn-add-bool").disabled = firstUnusedPair() === null;
  updateProcessState();
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgIcon(paths, { width = 13, height = 13, strokeWidth = 1.8 } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
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

// A seta do select é nossa (o .select tem appearance:none): a nativa é
// desenhada pelo SO e destoa entre plataformas e entre temas.
function buildBoolSelect(names, exclude, value, onChange) {
  const wrap = document.createElement("span");
  wrap.className = "select-wrap";

  const sel = document.createElement("select");
  sel.className = "select";
  for (const n of names) {
    if (n === exclude) continue;
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = displayName(n);
    opt.selected = n === value;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));

  const chevron = svgIcon(["M6 9l6 6 6-6"], { width: 12, height: 12, strokeWidth: 2 });
  chevron.classList.add("select-chevron");

  wrap.append(sel, chevron);
  return wrap;
}

// Etiqueta de uma peça, no mesmo formato do painel de estruturas do
// visualizador: barra de cor + nome. `color` é a cor da barra; `highlight`
// marca a peça que o backend pinta de amarelo (--w-highlight).
function buildStructTag(text, { color, highlight = false } = {}) {
  const span = document.createElement("span");
  span.className = "struct-tag";
  if (color) span.style.setProperty("--tag-color", color);
  if (highlight) span.dataset.highlight = "true";
  span.textContent = text;
  return span;
}

function buildBoolCard(op, index, duplicated, preview) {
  const names = selectedFiles.map((f) => f.name);
  // O botão remover é ancorado na linha inteira (canto superior direito), e o
  // padding-right reserva o espaço. Alinhado a um dos campos (mobile
  // empilhado) ele leria como "remover a referência".
  const li = document.createElement("li");
  li.className = "up-division";
  if (duplicated) li.dataset.duplicated = "true";

  const field = (labelText, select) => {
    const label = document.createElement("label");
    label.className = "up-division-field";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = labelText;
    label.append(caption, select);
    return label;
  };

  const selPrincipal = buildBoolSelect(names, null, op.principal, (value) => {
    op.principal = value;
    // A estrutura a dividir não pode ser a própria referência: troca para outra.
    if (op.secondary === value) op.secondary = names.find((n) => n !== value);
    renderBoolSection();
  });
  const selSecondary = buildBoolSelect(names, op.principal, op.secondary, (value) => {
    op.secondary = value;
    renderBoolSection();
  });

  const row = document.createElement("div");
  row.className = "up-division-fields";
  row.append(
    field("Referência · fica inteira", selPrincipal),
    field("A dividir · dentro e fora", selSecondary),
  );

  const { a, b, fora, dentro } = preview;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "up-division-remove";
  remove.appendChild(svgIcon(["M5 5l14 14", "M19 5L5 19"]));
  // O aria-label nomeia a divisão: um leitor de tela numa lista de várias
  // ouviria só "Remover divisão" e não saberia qual.
  const removeLabel = `Remover a divisão de ${b} por ${a}`;
  remove.title = removeLabel;
  remove.setAttribute("aria-label", removeLabel);
  remove.addEventListener("click", () => {
    boolOps.splice(index, 1);
    renderBoolSection();
  });

  // A prévia mostra os nomes que as peças terão na lista de estruturas do
  // visualizador, já com o encadeamento aplicado (ver previewNames). A barra
  // de cor faz o mesmo ramp de importância: a referência fica inteira (tinta
  // cheia), a peça de fora é o resto (fio apagado), a de dentro é o destaque
  // amarelo — a mesma cor que o modelo vai ter.
  const preview3 = document.createElement("div");
  preview3.className = "up-division-preview";
  preview3.append(
    buildStructTag(`${a} · fica inteira`, { color: "var(--w-ink-2)" }),
    buildStructTag(fora, { color: "var(--w-ink-3)" }),
    buildStructTag(`${dentro} · destaque`, {
      color: "var(--w-highlight)",
      highlight: true,
    }),
  );

  li.append(remove, row, preview3);
  return li;
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
  selectedFiles = [];
  boolOps = [];
  step = "files";
  $("file-input").value = "";
  renderFileList();
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
  if (selectedFiles.length === 0 || hasDuplicateBoolOps()) return;

  const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    return showError(
      `Arquivos somam ${mb} MB, excedendo o limite de 60 MB. Tente reduzir ou dividir o caso.`,
    );
  }

  show("processing");
  startRotator(
    boolOps.length
      ? [
          ...PHASE_UPLOAD.slice(0, 2),
          "Dividindo estruturas em dentro e fora...",
          ...PHASE_UPLOAD.slice(2),
        ]
      : PHASE_UPLOAD,
  );

  const form = new FormData();
  for (const f of selectedFiles) form.append("files", f);
  if (boolOps.length) form.append("boolean_ops", JSON.stringify(boolOps));

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

// Wire up events
$("file-input").addEventListener("change", (e) => {
  selectedFiles = Array.from(e.target.files);
  // Trocar os arquivos recomeça do passo 1: as divisões antigas não valem mais.
  boolOps = [];
  step = "files";
  renderFileList();
});

$("btn-continue").addEventListener("click", () => goToStep("divide"));
$("btn-back").addEventListener("click", () => goToStep("files"));
$("btn-process").addEventListener("click", process);
$("btn-new").addEventListener("click", reset);
$("btn-retry").addEventListener("click", reset);

$("btn-add-bool").addEventListener("click", () => {
  const pair = firstUnusedPair();
  if (pair) {
    boolOps.push(pair);
    renderBoolSection();
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
  // relatedTarget nulo/externo = o ponteiro saiu da zona de verdade, e não
  // apenas passou por cima de um filho (ícone, texto).
  if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) setDragging(false);
});
dropzone.addEventListener("drop", () => setDragging(false));

// Tema: mesma chave e mesmo comportamento do visualizador.
initTheme();
document
  .querySelectorAll('[data-action="theme-toggle"]')
  .forEach((el) => el.addEventListener("click", toggleTheme));

// Estado inicial: passo 1, sem trilha de passos (nada selecionado ainda).
renderStep();
