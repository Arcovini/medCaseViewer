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
let messageTimer = null;
let longWaitTimer = null;
let pollTimer = null;

function show(state) {
  for (const [name, el] of Object.entries(sections)) el.hidden = name !== state;
}

function renderFileList() {
  const list = $("file-list");
  list.innerHTML = "";
  for (const f of selectedFiles) {
    const li = document.createElement("li");
    li.className = "flex justify-between";
    const name = document.createElement("span");
    name.textContent = f.name;
    name.className = "truncate mr-2";
    const size = document.createElement("span");
    size.textContent = `${(f.size / 1024).toFixed(1)} KB`;
    size.className = "text-gray-400 shrink-0";
    li.append(name, size);
    list.appendChild(li);
  }
  renderBoolSection(); // também atualiza o estado do botão Processar
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
// dentra da referência) o backend a descarta e só a peça de dentro permanece.
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

function renderBoolSection() {
  const section = $("bool-section");
  if (!boolAvailable()) {
    boolOps = [];
    section.hidden = true;
    updateProcessState();
    return;
  }
  // Reconciliação: a seleção de arquivos mudou, descarta divisões órfãs.
  const names = selectedFiles.map((f) => f.name);
  boolOps = boolOps.filter(
    (op) => names.includes(op.principal) && names.includes(op.secondary),
  );
  section.hidden = false;

  const counts = {};
  for (const op of boolOps) counts[opKey(op)] = (counts[opKey(op)] || 0) + 1;

  const previews = previewNames(boolOps);
  const list = $("bool-list");
  list.innerHTML = "";
  boolOps.forEach((op, i) => {
    list.appendChild(buildBoolCard(op, i, counts[opKey(op)] > 1, previews[i]));
  });
  $("btn-add-bool").disabled = firstUnusedPair() === null;
  updateProcessState();
}

function buildBoolSelect(names, exclude, value, onChange) {
  const sel = document.createElement("select");
  // focus:outline-none só é aceitável porque o ring abaixo substitui o anel do
  // navegador; sem ele o select ficaria sem indicação de foco no teclado.
  sel.className =
    "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm " +
    "text-gray-800 hover:border-gray-400 focus:border-blue-500 " +
    "focus:ring-2 focus:ring-blue-200 focus:outline-none";
  for (const n of names) {
    if (n === exclude) continue;
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = displayName(n);
    opt.selected = n === value;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function buildBoolChip(text, colorClasses) {
  const span = document.createElement("span");
  span.className =
    `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${colorClasses}`;
  span.textContent = text;
  return span;
}

function buildBoolCard(op, index, duplicated, preview) {
  const names = selectedFiles.map((f) => f.name);
  // `relative` + `pr-9` reservam o canto para o botão remover posicionado
  // abaixo: ancorado no cartão, ele lê como "remover esta divisão" nos dois
  // layouts. Alinhado a um dos campos (mobile empilhado) leria como "remover a
  // referência".
  const li = document.createElement("li");
  li.className =
    "relative rounded-lg border p-3 pr-9 " +
    (duplicated ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50");

  const field = (labelText, select) => {
    const label = document.createElement("label");
    label.className = "block";
    const caption = document.createElement("span");
    caption.className =
      "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500";
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
  row.className = "grid gap-2 sm:grid-cols-2";
  row.append(
    field("Referência · fica inteira", selPrincipal),
    field("A dividir · dentro e fora", selSecondary),
  );

  const { a, b, fora, dentro } = preview;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "✕";
  // O aria-label nomeia a divisão: um leitor de tela num cartão entre vários
  // ouviria só "Remover divisão" e não saberia qual.
  const removeLabel = `Remover a divisão de ${b} por ${a}`;
  remove.title = removeLabel;
  remove.setAttribute("aria-label", removeLabel);
  remove.className =
    "absolute right-1.5 top-1.5 rounded p-1 text-sm leading-none text-gray-500 " +
    "hover:bg-gray-200 hover:text-gray-800";
  remove.addEventListener("click", () => {
    boolOps.splice(index, 1);
    renderBoolSection();
  });

  // Os dois últimos chips mostram os nomes que as peças terão na lista de
  // estruturas do visualizador, já com o encadeamento aplicado (ver previewNames).
  const chips = document.createElement("div");
  chips.className = "mt-2 flex flex-wrap gap-1.5";
  chips.append(
    buildBoolChip(`${a} · fica inteira`, "border-blue-200 bg-blue-50 text-blue-700"),
    buildBoolChip(fora, "border-gray-300 bg-white text-gray-600"),
    buildBoolChip(`${dentro} · destaque`, "border-yellow-300 bg-yellow-50 text-yellow-800"),
  );

  li.append(remove, row, chips);
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
  renderFileList();
});

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

$("btn-copy").addEventListener("click", async () => {
  const url = $("viewer-url").value;
  const btn = $("btn-copy");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    $("viewer-url").select();
    document.execCommand("copy");
  }
  btn.textContent = "Copiado!";
  setTimeout(() => {
    btn.textContent = original;
  }, 2000);
});
