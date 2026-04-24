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
let messageTimer = null;
let longWaitTimer = null;
let pollTimer = null;

function show(state) {
  for (const [name, el] of Object.entries(sections)) el.hidden = name !== state;
}

function renderFileList() {
  const list = $("file-list");
  list.innerHTML = "";
  $("btn-process").disabled = selectedFiles.length === 0;
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
  if (selectedFiles.length === 0) return;

  const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    return showError(
      `Arquivos somam ${mb} MB, excedendo o limite de 60 MB. Tente reduzir ou dividir o caso.`,
    );
  }

  show("processing");
  startRotator(PHASE_UPLOAD);

  const form = new FormData();
  for (const f of selectedFiles) form.append("files", f);

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
