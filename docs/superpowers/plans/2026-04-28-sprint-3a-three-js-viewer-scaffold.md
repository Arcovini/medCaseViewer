# Sprint 3a — Three.js viewer scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o viewer Three.js em `/case-next/?id=<uid>` que carrega um GLB do R2 e mostra toggles de visibilidade por estrutura, com 5 testes Playwright cobrindo smoke + interações + erros.

**Architecture:** ES modules separados em camadas (world/dom/loader/main), sem build step. Three.js via CDN com import map versionado. Três render-pipeline tunings (sRGB + ACES + RoomEnvironment) replicam o "feel" do Sketchfab sem usar a engine deles (Sketchfab usa OSG.JS, não Three.js).

**Tech Stack:** Three.js 0.164 (módulos via unpkg CDN), Playwright 1.x (dev dep), vanilla ES modules. R2 público via `pub-<hash>.r2.dev`.

**Spec:** [docs/superpowers/specs/2026-04-28-sprint-3a-three-js-viewer-scaffold-design.md](../specs/2026-04-28-sprint-3a-three-js-viewer-scaffold-design.md)

**Convenção sobre commits:** o usuário faz todos os commits manualmente. Cada task tem um marcador "**Ponto natural de commit**" no fim — quando bater nele, pause, mostre `git status`/`git diff`, e deixe o usuário decidir o que comitar e com qual mensagem.

---

## File Structure

```
medCaseViewer/
├── case-next/
│   ├── index.html       # canvas + import map + overlays + painel de estruturas
│   ├── style.css        # CSS local enxuto
│   ├── main.js          # composition root: lê UID, orquestra
│   ├── world.js         # Three.js: scene, camera, lights, controls, GLB
│   ├── dom.js           # UI helpers: structures panel, loading, error
│   └── loader.js        # fetch + parse GLB
├── tests/
│   └── case-next/
│       ├── case-next.spec.js                  # Playwright suite
│       └── fixtures/
│           └── sample.glb                     # GLB conhecido, comitado
├── playwright.config.js
├── package.json                               # dev-deps de teste apenas
├── package-lock.json                          # gerado pelo npm
└── .gitignore                                 # node_modules, playwright-report, test-results
```

---

## Task 1: Setup manual — habilitar R2 Public Access

**Files:** nenhum (configuração no painel Cloudflare)

- [ ] **Step 1.1: Acessar painel Cloudflare**

Abrir https://dash.cloudflare.com/ → R2 → bucket `clinical-3d` → aba **Settings**.

- [ ] **Step 1.2: Habilitar Public Access**

Na seção **Public Access**, clicar em **Allow Access**. Cloudflare pede confirmação ("anyone with the URL...") — aceitar.

- [ ] **Step 1.3: Copiar URL pública**

Após habilitar, aparece uma URL no formato `https://pub-<hash>.r2.dev`. Copiar e guardar — vai ser usada na Task 9 dentro do `main.js`.

- [ ] **Step 1.4: Verificar acesso público com um GLB existente**

```bash
curl -I "https://pub-<hash>.r2.dev/cases/<uid-de-teste>.glb"
```

**Esperado:** `HTTP/2 200` + `content-type: model/gltf-binary`. Se vier 404, confirmar que existe pelo menos um caso uploadado pós-Sprint-2 (uploads de 22-23/04 são pré-R2 e estão só no Sketchfab). Se precisar, fazer um upload novo via `/upload/`.

**Por que isso é Task 1:** sem Public Access ativo e URL conhecida, o resto do plano não roda end-to-end. Manual, mas bloqueante.

---

## Task 2: Gerar fixture GLB para testes

**Files:**
- Reutilizar: `mesh-processor/test_output/reynaldo_combined.glb` (já existe — 842KB, 4 estruturas)
- Create: `medCaseViewer/tests/case-next/fixtures/sample.glb`

- [ ] **Step 2.1: Copiar GLB combinado existente para fixtures**

```bash
mkdir -p /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/tests/case-next/fixtures
cp /Users/viniciusarcoverde/Documents/MedCase/mesh-processor/test_output/reynaldo_combined.glb \
   /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/tests/case-next/fixtures/sample.glb
```

- [ ] **Step 2.2: Verificar que o fixture tem os 4 nós nomeados esperados**

Abrir o fixture em https://gltf-viewer.donmccurdy.com/, arrastar `sample.glb`, e confirmar no painel "Scene" da direita: 4 nós nomeados (rim, lesão, veia, artéria — os exatos podem variar conforme o `clean_mesh_names`).

Anotar os nomes exatos — vão ser usados nos asserts do Test 2.

- [ ] **Step 2.3: Copiar SVGs de eye icon do `/case/` para o `/case-next/`**

Os ícones de olho aberto/fechado já existem no `/case/case/` e serão reusados como toggles visuais no novo viewer.

```bash
cp /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case/eye_icon.svg \
   /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/eye_icon.svg
cp /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case/eye_off_icon.svg \
   /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/case-next/eye_off_icon.svg
```

(O diretório `case-next/` ainda não existe; será criado na Task 4. Esses comandos vão falhar se rodados antes — adiar para depois da Task 4 Step 4.2 ou criar o diretório agora com `mkdir -p`.)

- [ ] **Ponto natural de commit:** "test: add sample.glb fixture for case-next tests" (apenas o fixture binário; ainda não há suite de testes).

---

## Task 3: Inicializar Playwright e package.json

**Files:**
- Create: `medCaseViewer/package.json`
- Create: `medCaseViewer/playwright.config.js`
- Modify: `medCaseViewer/.gitignore`

- [ ] **Step 3.1: Conceito (npm + Playwright)**

`npm` instala dependências de desenvolvimento sem que o site em produção precise delas. O Hostinger continua servindo só HTML/CSS/JS — `node_modules/` fica fora do .gitignore e nunca sobe. Playwright é uma ferramenta que dirige browsers reais (Chromium, Firefox, WebKit) via API — escrevemos JS dizendo "navegue, clique, espere", e ele faz, capturando screenshots e estado do DOM.

- [ ] **Step 3.2: Inicializar package.json**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer
npm init -y
```

Isso cria um `package.json` mínimo. Depois editar manualmente para deixar assim:

```json
{
  "name": "medcaseviewer",
  "version": "1.0.0",
  "private": true,
  "description": "Static frontend for biodesignlab — landing, viewer, upload pages.",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui"
  },
  "devDependencies": {}
}
```

`"private": true` evita publicar no npm acidentalmente.

- [ ] **Step 3.3: Instalar Playwright**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer
npm install -D @playwright/test
npx playwright install chromium
```

A primeira instala o pacote (atualiza `package.json` + cria `package-lock.json` + popula `node_modules/`). A segunda baixa o binário do Chromium que o Playwright usa internamente (~150MB, vai pra cache do usuário, não pro repo).

- [ ] **Step 3.4: Criar playwright.config.js**

```js
// playwright.config.js
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "list",
  timeout: 15_000,
  use: {
    baseURL: "http://127.0.0.1:5500",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

**Por que `baseURL: 127.0.0.1:5500`:** porta default do Live Server. O Playwright concatena com paths relativos: `await page.goto("/case-next/?id=...")` vira a URL completa.

**Por que `fullyParallel: false`:** suite pequena, e testes E2E que mexem em GL podem competir por GPU em paralelo. Mais previsível em série.

- [ ] **Step 3.5: Atualizar .gitignore**

Adicionar ao final do `medCaseViewer/.gitignore` (já tem `node_modules/`):

```
# Playwright
playwright-report/
test-results/
/playwright/.cache/
```

- [ ] **Step 3.6: Sanity check**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer
npx playwright test --list
```

**Esperado:** "No tests found" (não há `*.spec.js` ainda). Sem erro de configuração.

- [ ] **Ponto natural de commit:** "build: add playwright dev infra" (`package.json`, `package-lock.json`, `playwright.config.js`, `.gitignore`).

---

## Task 4: Esqueleto HTML + CSS

**Files:**
- Create: `medCaseViewer/case-next/index.html`
- Create: `medCaseViewer/case-next/style.css`

- [ ] **Step 4.1: Conceito (import map)**

ES modules permitem `import * from "three"` no browser, mas o browser precisa saber que `"three"` significa uma URL. Um `<script type="importmap">` é a tabela de tradução: lista no topo da página, antes de qualquer `<script type="module">`. Versão fixa (`@0.164.0`) evita quebra silenciosa quando upstream lança nova major.

- [ ] **Step 4.2: Criar index.html (visual shell parity com `/case/`)**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>biodesignlab — viewer</title>

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./style.css" />

    <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.164.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.164.0/examples/jsm/"
      }
    }
    </script>
  </head>
  <body>
    <canvas id="canvas"></canvas>

    <aside id="structures-panel" class="panel">
      <div class="panel-title">Estruturas</div>
      <ul id="structures-list"></ul>
    </aside>

    <div id="loading" class="overlay" hidden>Carregando...</div>
    <div id="error" class="overlay error" hidden></div>

    <script type="module" src="./main.js"></script>
  </body>
</html>
```

**Notas:**
- Fontes Nunito Sans / Open Sans replicam a tipografia do `/case/`.
- Painel é `<aside>` posicionado absolutamente; sem grid system. Visual igual ao `/case/`.

- [ ] **Step 4.3: Criar style.css (visual shell parity)**

```css
/* Reset mínimo. Sem Bootstrap legado. */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  background: #272425;
  color: #ffffff;
  font-family: "Nunito Sans", "Open Sans", system-ui, -apple-system, sans-serif;
  overflow: hidden;
}

#canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}

/* Painel "Estruturas" — replica visual do /case/. */
.panel {
  position: fixed;
  top: 80px;
  right: 24px;
  width: 280px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 16px;
  border-radius: 8px;
  background-color: rgb(59, 57, 57);
  color: #ffffff;
  z-index: 999;
}

.panel-title {
  font-family: "Nunito Sans", sans-serif;
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.panel ul {
  list-style: none;
}

.panel li {
  padding: 10px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel li:last-child {
  border-bottom: none;
}

.structure-name {
  font-size: 15px;
  font-weight: 400;
  flex: 1;
}

/* Botão de toggle com ícone de olho — substitui o checkbox nativo. */
.eye-toggle {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  width: 44px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}

.eye-toggle:hover {
  background: rgba(0, 0, 0, 0.4);
}

.eye-toggle img {
  width: 20px;
  height: 20px;
  filter: invert(1);  /* SVGs originais são pretos; invertemos para branco */
}

/* Overlays de loading / erro */
.overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 16px 24px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.85);
  font-size: 14px;
  text-align: center;
  max-width: 80vw;
}

.overlay.error {
  border: 1px solid #BD0006;
}
```

- [ ] **Step 4.4: Verificar no browser**

Abrir Live Server, navegar pra `http://127.0.0.1:5500/case-next/?id=qualquer`. Deve aparecer:
- Tela preta full-screen (canvas existe mas vazio)
- Painel "Estruturas" no canto superior direito, com lista vazia
- Console: erro 404 do `main.js` (não existe ainda) — esperado.

- [ ] **Ponto natural de commit:** "feat(case-next): add empty html scaffold + css".

---

## Task 5: Test 1 (smoke) — RED

**Files:**
- Create: `medCaseViewer/tests/case-next/case-next.spec.js`

- [ ] **Step 5.1: Conceito (TDD com Playwright)**

Vamos escrever o teste **antes** de implementar o JS. O teste vai falhar de uma forma específica (canvas vazio / sem render). Quando construirmos `world.js`, `loader.js`, `main.js` nas próximas tasks, o teste passa de RED para GREEN — sinal objetivo de progresso.

- [ ] **Step 5.2: Escrever Test 1 (smoke)**

```js
// tests/case-next/case-next.spec.js
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");

const TEST_UID = "test-fixture-abc123";

async function fixtureBytes() {
  return fs.readFile(FIXTURE_PATH);
}

// Intercepta qualquer request para o GLB do fixture e responde com os bytes locais.
// Isso desacopla o teste de R2 e da rede.
async function mockGlbRoute(page, statusOverride = 200) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    if (statusOverride !== 200) {
      await route.fulfill({ status: statusOverride });
      return;
    }
    const body = await fixtureBytes();
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body,
    });
  });
}

test("smoke: canvas renderiza conteúdo do GLB do fixture", async ({ page }) => {
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  // Espera o canvas existir e ter tamanho > 0
  const canvas = page.locator("#canvas");
  await expect(canvas).toBeVisible();

  // Espera o painel renderizar (sinal de que main.js terminou a pipeline)
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  // Sanity: erro overlay NÃO está visível
  await expect(page.locator("#error")).toBeHidden();
});
```

**Por que `toHaveCount(4)`:** o fixture tem 4 estruturas. Esse número confirma que tanto o parse quanto o render-de-painel funcionaram — uma asserção mais robusta que checar pixels.

- [ ] **Step 5.3: Subir Live Server e rodar o teste**

Em um terminal: VS Code Live Server na pasta `medCaseViewer/` (Cmd+Shift+P → "Open with Live Server" no `index.html` ou na raiz).

Em outro terminal:
```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer
npx playwright test
```

**Esperado:** RED — `Locator '#structures-list li' resolved to 0 elements` (porque `main.js` ainda não existe). Confirma que o teste está testando a coisa certa.

- [ ] **Ponto natural de commit:** "test(case-next): add smoke test (currently failing — RED)".

---

## Task 6: world.js — renderer, scene, camera, lights, render loop

**Files:**
- Create: `medCaseViewer/case-next/world.js`

- [ ] **Step 6.1: Conceito (anatomia mínima de uma cena Three.js)**

5 ingredientes obrigatórios:
1. **Renderer** — quem desenha pixels no canvas (`WebGLRenderer`)
2. **Scene** — container da árvore de objetos 3D
3. **Camera** — ponto de vista (`PerspectiveCamera`: FOV, aspect, near, far)
4. **Lights / environment** — sem luz, materiais PBR aparecem pretos. Aqui usamos `RoomEnvironment` (procedural, built-in)
5. **Render loop** — `requestAnimationFrame` → `renderer.render(scene, camera)` 60x/s

`OrbitControls` é um addon que liga clicks/drags do mouse a movimentos da câmera (orbit, zoom, pan).

- [ ] **Step 6.2: Escrever world.js**

```js
// case-next/world.js
// Tudo o que vive dentro do canvas: scene, camera, renderer, lights, controls.
// Não toca em DOM além do canvas que recebe.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

let renderer, scene, camera, controls;
let pmremGenerator;
const namedMeshes = new Map();
let mountedRoot = null;

export function init(canvasEl) {
  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene + environment (IBL procedural — sem HDR file)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x272425);  // mesmo tom do body do /case/

  pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  // Camera (defaults; serão recalculados em frameToScene após mount)
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 3);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Resize
  window.addEventListener("resize", onResize);

  // Render loop
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

  // Indexa meshes por nome para setVisibility usar depois
  namedMeshes.clear();
  rootObject.traverse((child) => {
    if (child.isMesh && child.name) {
      namedMeshes.set(child.name, child);
    }
  });
}

export function setVisibility(name, visible) {
  const mesh = namedMeshes.get(name);
  if (mesh) mesh.visible = visible;
}

export function frameToScene() {
  if (!mountedRoot) return;

  const box = new THREE.Box3().setFromObject(mountedRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5;

  // Posiciona câmera a ~2x o raio no eixo Z, olhando pro centro
  camera.position.set(center.x, center.y, center.z + radius * 2.2);
  camera.near = Math.max(radius * 0.01, 0.001);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

export function getMeshNames() {
  return Array.from(namedMeshes.keys());
}
```

**Por que `getMeshNames()` é exportado:** `main.js` precisa passar a lista pra `dom.renderStructures(...)`. Mantém `dom.js` independente do mundo 3D.

- [ ] **Step 6.3: Verificar no browser (sanity, sem teste ainda)**

Recarregar a página com Live Server. Console ainda mostra erro de `main.js` 404 (esperado), mas se houver erro de import do Three.js, é momento de descobrir antes de prosseguir.

- [ ] **Ponto natural de commit:** "feat(case-next): add world.js — three.js scene scaffold".

---

## Task 7: loader.js — fetch + parse GLB

**Files:**
- Create: `medCaseViewer/case-next/loader.js`

- [ ] **Step 7.1: Conceito (fetch → ArrayBuffer → GLTFLoader.parseAsync)**

`fetch(url)` retorna uma `Response`. `.arrayBuffer()` extrai os bytes brutos como um `ArrayBuffer` (formato JS pra dados binários). `GLTFLoader.parseAsync(buffer, "")` lê o header GLB, separa JSON + binário, instancia `THREE.Mesh`, `THREE.Material`, `THREE.Group` em memória.

O `""` no segundo parâmetro é o "path" base pra textures externas — GLB tem tudo embutido, então é vazio.

- [ ] **Step 7.2: Escrever loader.js**

```js
// case-next/loader.js
// Rede: baixa GLB do R2 e parseia para árvore Three.js.
// Não conhece scene, camera ou DOM.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadGlb(url) {
  const response = await fetch(url);

  if (response.status === 404) {
    const err = new Error("GLB_NOT_FOUND");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Falha ao baixar GLB: HTTP ${response.status}`);
    err.code = "NETWORK";
    throw err;
  }

  const buffer = await response.arrayBuffer();

  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, "");
  } catch (e) {
    const err = new Error("Falha ao parsear GLB");
    err.code = "PARSE";
    err.cause = e;
    throw err;
  }

  return { root: gltf.scene };
}
```

**Por que `err.code` em vez de instanceof:** chamador (`main.js`) faz switch no código sem precisar importar tipos de erro. Padrão simples; promove via spec se virar muitos casos.

**Por que retorna apenas `{ root }` e não `{ root, namedMeshes }` como o spec dizia:** o `world.mount()` já indexa meshes internamente (Task 6). Retornar só `root` mantém `loader.js` ainda mais magro. Atualização válida do contrato durante implementação.

- [ ] **Ponto natural de commit:** "feat(case-next): add loader.js — fetch + parse GLB".

---

## Task 8: main.js — composition root + Test 1 GREEN

**Files:**
- Create: `medCaseViewer/case-next/main.js`

- [ ] **Step 8.1: Conceito (composition root)**

`main.js` é o único arquivo que conhece todos os outros módulos. Ele lê o que precisa do ambiente (URL, query string), monta a config (URL do GLB), chama os módulos na ordem certa, e gerencia transições de estado (loading → mounted, ou loading → error).

- [ ] **Step 8.2: Escrever main.js (versão mínima — só o suficiente pra passar Test 1)**

```js
// case-next/main.js
// Composition root: lê UID da URL, baixa GLB do R2, monta cena, renderiza painel.

import * as world from "./world.js";
import * as loader from "./loader.js";

// Substituir <hash> pela URL real do R2 Public Access (Task 1, Step 1.3).
const R2_PUBLIC_BASE = "https://pub-<hash>.r2.dev";

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("id");

  const canvas = document.getElementById("canvas");
  world.init(canvas);

  if (!uid) {
    // (Erro de UID ausente vira mensagem na Task 11. Por enquanto: console.)
    console.error("UID ausente");
    return;
  }

  const url = `${R2_PUBLIC_BASE}/cases/${uid}.glb`;
  const { root } = await loader.loadGlb(url);

  world.mount(root);
  world.frameToScene();

  // Renderiza lista de estruturas usando os nomes que world.js indexou
  const list = document.getElementById("structures-list");
  for (const name of world.getMeshNames()) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => world.setVisibility(name, cb.checked));
    const label = document.createElement("label");
    label.textContent = name;
    li.appendChild(cb);
    li.appendChild(label);
    list.appendChild(li);
  }
}

bootstrap();
```

**Nota sobre `dom.js`:** essa task ainda não cria `dom.js` — a renderização de estruturas está inline em `main.js`. Vamos refatorar pra `dom.js` na Task 9, depois que Test 1 estiver verde. Refatorar com testes verdes é seguro; refatorar com testes vermelhos não.

- [ ] **Step 8.3: Rodar o teste**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer
npx playwright test
```

**Esperado:** GREEN no test "smoke: canvas renderiza conteúdo do GLB do fixture". Se vermelho:
- Abrir o relatório: `npx playwright show-report`
- Ver screenshot/trace do failure
- Causas comuns: URL do mock route não bateu (cheque se `R2_PUBLIC_BASE` aponta pro `pub-<hash>.r2.dev` e se a route do teste intercepta `**/cases/${TEST_UID}.glb` — o glob `**` cobre qualquer host)

- [ ] **Step 8.4: Verificação visual no browser (opcional mas recomendado)**

Recarregar a página com `?id=<uid-real>` apontando pra um caso pós-Sprint-2 do R2. Esperado: modelo 3D renderiza, painel com estruturas marcadas. Se renderizar preto/escuro demais: verificar se IBL (`scene.environment`) foi aplicado.

- [ ] **Ponto natural de commit:** "feat(case-next): wire main.js — first GLB renders, smoke test passes".

---

## Task 9: dom.js — extrair UI helpers

**Files:**
- Create: `medCaseViewer/case-next/dom.js`
- Modify: `medCaseViewer/case-next/main.js`

- [ ] **Step 9.1: Conceito (refatorar com teste verde)**

Test 1 está verde. Vamos extrair a parte de UI inline em `main.js` pra `dom.js`, mantendo a mesma cobertura — se o teste continuar verde, a refatoração preservou comportamento.

- [ ] **Step 9.2: Criar dom.js (com toggle de ícone de olho)**

```js
// case-next/dom.js
// UI helpers: painel de estruturas, loading e error overlays.
// Não conhece Three.js além do nome (string) das estruturas.

const list = document.getElementById("structures-list");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");

const EYE_ON = "./eye_icon.svg";
const EYE_OFF = "./eye_off_icon.svg";

export function showLoading(visible) {
  loadingEl.hidden = !visible;
}

export function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

export function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

export function renderStructures(names, onToggle) {
  list.innerHTML = "";
  for (const name of names) {
    const li = document.createElement("li");

    const labelEl = document.createElement("span");
    labelEl.className = "structure-name";
    labelEl.textContent = name;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eye-toggle";
    btn.dataset.visible = "true";
    btn.dataset.structureName = name;  // hook para testes Playwright

    const img = document.createElement("img");
    img.src = EYE_ON;
    img.alt = "Visível";
    btn.appendChild(img);

    btn.addEventListener("click", () => {
      const nowVisible = btn.dataset.visible !== "true";
      btn.dataset.visible = String(nowVisible);
      img.src = nowVisible ? EYE_ON : EYE_OFF;
      img.alt = nowVisible ? "Visível" : "Oculto";
      onToggle(name, nowVisible);
    });

    li.appendChild(labelEl);
    li.appendChild(btn);
    list.appendChild(li);
  }
}
```

**Mudanças relevantes vs versão anterior:**
- Substitui `<input type="checkbox">` por `<button class="eye-toggle">` com `<img>` que alterna entre `eye_icon.svg` e `eye_off_icon.svg` — visual idêntico ao `/case/`.
- `data-structure-name` no botão facilita asserts no Playwright (selecionar pelo nome em vez de index).
- Estado da visibilidade vive em `data-visible` (`"true"`/`"false"`), inspecionável via DevTools sem JS.

- [ ] **Step 9.3: Atualizar main.js para usar dom.js**

Substituir o conteúdo inteiro do `main.js` por:

```js
// case-next/main.js
// Composition root: lê UID da URL, baixa GLB do R2, monta cena, renderiza painel.

import * as world from "./world.js";
import * as loader from "./loader.js";
import * as dom from "./dom.js";

// Substituir <hash> pela URL real do R2 Public Access (Task 1, Step 1.3).
const R2_PUBLIC_BASE = "https://pub-<hash>.r2.dev";

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("id");

  const canvas = document.getElementById("canvas");
  world.init(canvas);

  if (!uid) {
    console.error("UID ausente");
    return;
  }

  dom.showLoading(true);
  const url = `${R2_PUBLIC_BASE}/cases/${uid}.glb`;
  const { root } = await loader.loadGlb(url);

  world.mount(root);
  world.frameToScene();

  dom.renderStructures(world.getMeshNames(), (name, visible) => {
    world.setVisibility(name, visible);
  });
  dom.showLoading(false);
}

bootstrap();
```

- [ ] **Step 9.4: Rodar o teste**

```bash
npx playwright test
```

**Esperado:** ainda GREEN. Se virar vermelho, a refatoração quebrou algo — dar `git diff` e procurar a divergência.

- [ ] **Ponto natural de commit:** "refactor(case-next): extract dom.js from main.js".

---

## Task 10: Test 2 — painel renderiza um item por mesh nomeado (RED → GREEN)

**Files:**
- Modify: `medCaseViewer/tests/case-next/case-next.spec.js`

- [ ] **Step 10.1: Adicionar Test 2**

No `case-next.spec.js`, adicionar **depois** do test 1:

```js
test("painel renderiza nomes corretos das estruturas do fixture", async ({ page }) => {
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  // Aguarda o painel carregar
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  // Cada nome deve ser uma string não-vazia (regressão simples — se quiser nomes exatos,
  // colocar aqui os nomes que o Step 2.2 anotou: ex: "Art Renal Dir", "Lesão", "Rim Dir", "Veia Renal Dir").
  // Seletor `.structure-name` bate com o `<span class="structure-name">` que `dom.js` cria.
  const names = await page.locator("#structures-list .structure-name").allTextContents();
  expect(names).toHaveLength(4);
  for (const name of names) {
    expect(name.trim().length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 10.2: Rodar**

```bash
npx playwright test
```

**Esperado:** GREEN — porque a infraestrutura do painel já foi feita na Task 8/9. O Test 2 confirma que continua funcionando.

Se quiser asserts mais rigorosos (nomes exatos), substituir o loop por algo como:
```js
expect(labels.sort()).toEqual(["Art Renal Dir", "Lesão", "Rim Dir", "Veia Renal Dir"].sort());
```
(usando os nomes que o Step 2.2 anotou).

- [ ] **Ponto natural de commit:** "test(case-next): add structures panel render test".

---

## Task 11: Test 3 — toggle esconde/mostra (RED → GREEN)

**Files:**
- Modify: `medCaseViewer/tests/case-next/case-next.spec.js`

- [ ] **Step 11.1: Conceito (assertion sobre estado da cena, não sobre pixels)**

Comparar pixels antes/depois do click é frágil — mudanças de iluminação ou GL state podem dar falsos positivos. Estratégia mais robusta: expor um "test hook" no `world.js` que o teste consulta. Não é prod-only — é uma API documentada de inspeção.

- [ ] **Step 11.2: Adicionar `getMeshVisibility` em world.js**

Adicionar essa função em `case-next/world.js` (no fim do arquivo, ao lado de `getMeshNames`):

```js
export function getMeshVisibility(name) {
  const mesh = namedMeshes.get(name);
  return mesh ? mesh.visible : null;
}
```

- [ ] **Step 11.3: Expor o módulo `world` no `window` quando estiver em ambiente de teste**

No fim do `main.js`, depois de `bootstrap();`:

```js
// Hook de teste: quando rodando sob Playwright, expõe o módulo world
// para inspeção. Não afeta produção (só pra ler estado, não mutável).
if (window.__playwrightTest) {
  window.__world = world;
}
```

E no `case-next.spec.js`, antes de `page.goto(...)` em qualquer teste, marcar a flag:

```js
await page.addInitScript(() => { window.__playwrightTest = true; });
```

- [ ] **Step 11.4: Adicionar Test 3**

```js
test("toggle de eye-button esconde e mostra a estrutura na cena", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  // Pega o nome da primeira estrutura via data attribute do botão (mais robusto que ler label)
  const firstButton = page.locator(".eye-toggle").first();
  const name = await firstButton.getAttribute("data-structure-name");

  // Estado inicial: visível
  let visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(true);
  await expect(firstButton).toHaveAttribute("data-visible", "true");

  // Click 1: esconder
  await firstButton.click();

  visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(false);
  await expect(firstButton).toHaveAttribute("data-visible", "false");

  // Click 2: mostrar de novo
  await firstButton.click();

  visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(true);
  await expect(firstButton).toHaveAttribute("data-visible", "true");
});
```

Atualizar também os testes 1 e 2 pra adicionar a `addInitScript` no início (consistência). Para Test 2, o seletor de "label" precisa virar `.structure-name` em vez de `label`:

```js
const labels = await page.locator("#structures-list .structure-name").allTextContents();
```

- [ ] **Step 11.5: Rodar**

```bash
npx playwright test
```

**Esperado:** todos GREEN.

- [ ] **Ponto natural de commit:** "test(case-next): add toggle visibility test + world test hook".

---

## Task 12: Test 4 — URL sem `?id=` mostra mensagem de erro (RED → GREEN)

**Files:**
- Modify: `medCaseViewer/case-next/main.js`
- Modify: `medCaseViewer/tests/case-next/case-next.spec.js`

- [ ] **Step 12.1: Adicionar Test 4 (RED)**

No `case-next.spec.js`:

```js
test("URL sem ?id= mostra mensagem de erro", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await page.goto("/case-next/");

  const errorEl = page.locator("#error");
  await expect(errorEl).toBeVisible();
  await expect(errorEl).toContainText("UID do caso não informado");
});
```

Rodar:
```bash
npx playwright test --grep "sem \\?id="
```

**Esperado:** RED. `#error` está com `hidden`.

- [ ] **Step 12.2: Implementar tratamento de UID ausente em main.js**

Substituir o bloco `if (!uid) { console.error("UID ausente"); return; }` por:

```js
  if (!uid) {
    dom.showError("UID do caso não informado na URL.");
    return;
  }
```

- [ ] **Step 12.3: Rodar**

```bash
npx playwright test
```

**Esperado:** todos GREEN.

- [ ] **Ponto natural de commit:** "feat(case-next): show error overlay when UID missing".

---

## Task 13: Test 5 — UID inexistente mostra erro (RED → GREEN)

**Files:**
- Modify: `medCaseViewer/case-next/main.js`
- Modify: `medCaseViewer/tests/case-next/case-next.spec.js`

- [ ] **Step 13.1: Adicionar Test 5 (RED)**

No `case-next.spec.js`:

```js
test("UID inexistente (404 do R2) mostra mensagem de erro", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page, 404);  // helper interceta e retorna 404
  await page.goto(`/case-next/?id=${TEST_UID}`);

  const errorEl = page.locator("#error");
  await expect(errorEl).toBeVisible();
  await expect(errorEl).toContainText("Caso não encontrado");
  await expect(errorEl).toContainText(TEST_UID);
});
```

Rodar:
```bash
npx playwright test --grep "404"
```

**Esperado:** RED. O `loader.loadGlb` joga `Error("GLB_NOT_FOUND")` mas `main.js` ainda não trata.

- [ ] **Step 13.2: Implementar tratamento em main.js**

Substituir o bloco do `bootstrap` que faz o `loadGlb` por um `try/catch`:

```js
  dom.showLoading(true);
  const url = `${R2_PUBLIC_BASE}/cases/${uid}.glb`;

  let root;
  try {
    ({ root } = await loader.loadGlb(url));
  } catch (e) {
    dom.showLoading(false);
    if (e.code === "NOT_FOUND") {
      dom.showError(`Caso não encontrado: ${uid}.`);
    } else if (e.code === "PARSE") {
      dom.showError("Arquivo do modelo está corrompido. Contate o suporte.");
    } else {
      dom.showError("Erro ao carregar o modelo. Verifique sua conexão e tente novamente.");
    }
    return;
  }

  world.mount(root);
  world.frameToScene();

  dom.renderStructures(world.getMeshNames(), (name, visible) => {
    world.setVisibility(name, visible);
  });
  dom.showLoading(false);
```

- [ ] **Step 13.3: Rodar a suite inteira**

```bash
npx playwright test
```

**Esperado:** 5 testes GREEN.

- [ ] **Ponto natural de commit:** "feat(case-next): handle 404 + parse + network errors with user-facing messages".

---

## Task 14: Validação manual end-to-end com R2 real

**Files:** nenhum (validação manual; documentar resultado)

- [ ] **Step 14.1: Confirmar que `R2_PUBLIC_BASE` está com a URL real**

Abrir `medCaseViewer/case-next/main.js`, conferir que `R2_PUBLIC_BASE` foi trocado de `"https://pub-<hash>.r2.dev"` para a URL real obtida no Step 1.3. Se ainda estiver com placeholder, atualizar agora.

- [ ] **Step 14.2: Garantir que existe um GLB em R2**

Pré-condição da Task 1, Step 1.4. Se ainda não houver caso pós-Sprint-2, fazer um upload novo:

```bash
# Em um terminal, rodar mesh-processor (DRY_RUN=false, com creds reais ou DRY_RUN=true pra teste local)
cd /Users/viniciusarcoverde/Documents/MedCase/mesh-processor
source .venv/bin/activate
set -a && source .env && set +a
uvicorn main:app --reload --port 8000

# Em outro terminal, abrir Live Server na medCaseViewer, navegar pra /upload/
# Subir uma STL da pasta Reynaldo, copiar o UID do retorno
```

- [ ] **Step 14.3: Abrir `/case-next/` no browser real**

```
http://127.0.0.1:5500/case-next/?id=<uid-recente>
```

Verificar visualmente:
1. Modelo 3D aparece centralizado
2. Câmera enquadra o modelo (não tá longe demais nem cortado)
3. OrbitControls funcionam: drag esquerdo orbita, scroll dá zoom, drag direito faz pan
4. Painel "Estruturas" mostra um item por estrutura, todas marcadas
5. Desmarcar checkbox esconde a estrutura; marcar de novo mostra
6. Aparência razoavelmente próxima do Sketchfab (reflexos PBR aparentes, tone mapping cinematográfico)

- [ ] **Step 14.4: Casos de erro reais**

Testar manualmente:
1. `http://127.0.0.1:5500/case-next/` → "UID do caso não informado na URL."
2. `http://127.0.0.1:5500/case-next/?id=uid-que-nao-existe` → "Caso não encontrado: uid-que-nao-existe."

- [ ] **Step 14.5: Anotar follow-ups visuais**

Se a aparência ficar pobre (luz chapada, modelo escuro demais, contraste estranho), anotar como follow-up pro 3b ("ajustar exposure", "trocar pra HDRI"). Não bloqueia o 3a — o critério de aceite é funcional.

- [ ] **Ponto natural de commit:** se ajustar `R2_PUBLIC_BASE`, "config(case-next): set R2 public base URL".

---

## Task 15 (opcional): Smoke test Sketchfab pra evitar regressão no /case/ atual

Esse é o teste que **teria pegado** o incidente do diretor da clínica. Não é exigência do 3a, mas vale antes de seguir pro 3b.

**Files:**
- Create: `medCaseViewer/tests/case/case-sketchfab.spec.js`

- [ ] **Step 15.1: Escrever smoke do `/case/` em produção**

```js
// tests/case/case-sketchfab.spec.js
import { test, expect } from "@playwright/test";

const PROD_BASE = "https://biodesignlab.com.br";
const KNOWN_GOOD_UID = "<uid-de-um-caso-funcional-em-prod>";  // preencher

test("sketchfab viewer carrega caso conhecido em produção", async ({ page }) => {
  await page.goto(`${PROD_BASE}/case/?id=${KNOWN_GOOD_UID}`);

  // O iframe do Sketchfab carrega assincronamente; espera ele aparecer
  const iframe = page.locator("iframe#api-frame");
  await expect(iframe).toBeVisible();

  // Verifica que NÃO apareceu mensagem genérica de erro do Sketchfab
  await expect(page.locator("text=Model not found")).toHaveCount(0);
});
```

- [ ] **Step 15.2: Rodar**

```bash
npx playwright test tests/case/case-sketchfab.spec.js
```

**Esperado:** GREEN se o caso de referência (KNOWN_GOOD_UID) existe e está saudável no Sketchfab. Esse teste pode rodar manualmente após cada deploy do `medCaseViewer`. CI fica como follow-up.

- [ ] **Ponto natural de commit:** "test(case): add production smoke test for sketchfab viewer".

---

## Done condition (critério de aceite)

- [ ] 5 testes Playwright passando: smoke, painel, toggle, no-UID, 404
- [ ] Modelo 3D real (caso pós-Sprint-2) renderiza em `/case-next/?id=<uid>` no Live Server
- [ ] Toggles de estrutura escondem e mostram cada mesh
- [ ] Mensagens de erro aparecem em pt-BR para os 2 caminhos testáveis (sem UID, UID inexistente)
- [ ] `medCaseViewer/case/` (Sketchfab atual) **não foi tocado** — clínicos veem o mesmo viewer de hoje
- [ ] `mesh-processor/` **não foi tocado** — backend não mudou
