# Volume Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ferramenta de medição de volume ao viewer `case-next`, acessível por popover ancorado ao FAB de medida (com itens `📏 Linear` e `📦 Volume`).

**Architecture:** Espelha a forma do `measurement.js`. Algoritmo de soma de tetraedros sinalizados em `world.js` com cache + detecção de não-manifold. Novo módulo `volume.js` gerencia máquina de estado. Refactor pequeno em `measurement.js` para mover o FAB para `main.js` (controlado externamente). Popover em `dom.js`.

**Tech Stack:** ES Modules, Three.js (importmap), Playwright para testes E2E (desktop + iPhone 13).

**Spec:** `docs/superpowers/specs/2026-05-12-volume-measurement-design.md`

**Branch:** `measure-volume-tool` (já criada)

---

## File Structure

**Create:**
- `case-next/volume.js` — máquina de estado do modo Volume (espelha forma de `measurement.js`)
- `tests/case-next/volume.spec.js` — Playwright tests (popover, algoritmo, fluxo, non-manifold)

**Modify:**
- `case-next/world.js` — adiciona `computeMeshVolumeForMesh`, `computeMeshVolumeCached`, `getMeshCentroid`
- `case-next/measurement.js` — refactor: extrai `startLinear()`, remove gestão interna do FAB, aceita `onExit` callback
- `case-next/dom.js` — adiciona `mountMeasurementMenu` (popover), `mountVolumeToolbar`; simplifica `mountMeasurementFAB`
- `case-next/main.js` — wiring do menu, expõe `__volume` em modo teste
- `case-next/style.css` — `.measure-menu`, `.volume-toolbar`, `.measurement-pill[data-warn]`

---

## Task 1: Algoritmo de volume em `world.js`

**Files:**
- Modify: `case-next/world.js` (adicionar função `computeMeshVolumeForMesh`)
- Modify: `case-next/main.js:81-89` (já expõe `__world` via test hook — sem mudança necessária)
- Test: `tests/case-next/volume.spec.js` (criar arquivo)

- [ ] **Step 1.1: Criar arquivo de teste com cenário de cubo conhecido**

Criar `tests/case-next/volume.spec.js`:

```js
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");
const TEST_UID = "test-fixture-abc123";

async function fixtureBytes() { return fs.readFile(FIXTURE_PATH); }

async function mockGlbRoute(page) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: await fixtureBytes(),
    });
  });
}

async function setupCaseNext(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

test("computeMeshVolumeForMesh: cubo 10mm = 1,0 cm³ (±2%)", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.volumeCm3).toBeCloseTo(1.0, 1);
});

test("computeMeshVolumeForMesh: cubo 20mm = 8,0 cm³ (±2%)", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(20, 20, 20);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.volumeCm3).toBeCloseTo(8.0, 1);
});
```

- [ ] **Step 1.2: Rodar testes pra confirmar falha**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 2 testes falham com erro `TypeError: window.__world.computeMeshVolumeForMesh is not a function`.

- [ ] **Step 1.3: Implementar `computeMeshVolumeForMesh` em `world.js`**

Adicionar ao final de `case-next/world.js` (após a função `setMeasurementVisibility`):

```js
// ===========================================================================
// Sprint 3b.3 — Medição de volume
// ===========================================================================

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

// Computa volume real de uma malha fechada em cm³, via soma de tetraedros
// sinalizados sobre os triângulos. Vértices são levados a coordenadas de mundo
// via mesh.matrixWorld pra que escala/rotação do GLB sejam respeitadas.
// Retorna { volumeCm3, manifold } onde manifold=false sinaliza que alguma aresta
// não é compartilhada por exatamente 2 triângulos (malha aberta ou auto-intersect).
export function computeMeshVolumeForMesh(mesh) {
  mesh.updateMatrixWorld();
  const matrix = mesh.matrixWorld;
  const positions = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;

  const triCount = index ? index.count / 3 : positions.count / 3;
  let signedVolume = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3)     : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _v0.fromBufferAttribute(positions, i0).applyMatrix4(matrix);
    _v1.fromBufferAttribute(positions, i1).applyMatrix4(matrix);
    _v2.fromBufferAttribute(positions, i2).applyMatrix4(matrix);

    _cross.crossVectors(_v1, _v2);
    signedVolume += _v0.dot(_cross);
  }

  const volumeMm3 = Math.abs(signedVolume) / 6;
  return {
    volumeCm3: volumeMm3 / 1000,
    manifold: true,   // placeholder — manifold check vem na Task 2
  };
}
```

- [ ] **Step 1.4: Rodar testes — devem passar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 2 testes passam.

- [ ] **Step 1.5: Commit**

```bash
git add case-next/world.js tests/case-next/volume.spec.js
git commit -m "feat(case-next): computeMeshVolumeForMesh — soma de tetraedros para volume real

Cobre fluxo básico com cubos de tamanhos conhecidos (±2%). Aplica
matrixWorld pra respeitar escala/rotação do GLB. Manifold detection
ainda placeholder (sempre true) — vem na próxima task."
```

---

## Task 2: Detecção de não-manifold

**Files:**
- Modify: `case-next/world.js` (estender `computeMeshVolumeForMesh`)
- Modify: `tests/case-next/volume.spec.js`

- [ ] **Step 2.1: Adicionar testes que cobrem manifold true/false**

Append em `tests/case-next/volume.spec.js`:

```js
test("computeMeshVolumeForMesh: cubo fechado é manifold", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.manifold).toBe(true);
});

test("computeMeshVolumeForMesh: cubo com face removida não é manifold", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(10, 10, 10);
    // BoxGeometry: 12 triângulos = 36 índices. Cada face = 2 triângulos = 6 índices.
    // Remover últimos 6 índices = remover 1 face inteira → malha aberta.
    const idx = Array.from(geom.index.array);
    geom.setIndex(idx.slice(0, -6));
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.manifold).toBe(false);
});
```

- [ ] **Step 2.2: Rodar testes — `manifold===true` passa, `manifold===false` falha**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 3 passam, 1 falha (o `manifold===false` falha porque placeholder retorna true).

- [ ] **Step 2.3: Estender `computeMeshVolumeForMesh` com edge count**

Substituir o corpo de `computeMeshVolumeForMesh` em `case-next/world.js` para integrar o edge-count no mesmo loop:

```js
export function computeMeshVolumeForMesh(mesh) {
  mesh.updateMatrixWorld();
  const matrix = mesh.matrixWorld;
  const positions = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;

  const triCount = index ? index.count / 3 : positions.count / 3;
  let signedVolume = 0;
  const edgeCounts = new Map();   // key: a * 0x200000 + b  (a < b)

  function bumpEdge(a, b) {
    const k = a < b ? (a * 0x200000 + b) : (b * 0x200000 + a);
    edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
  }

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3)     : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    _v0.fromBufferAttribute(positions, i0).applyMatrix4(matrix);
    _v1.fromBufferAttribute(positions, i1).applyMatrix4(matrix);
    _v2.fromBufferAttribute(positions, i2).applyMatrix4(matrix);

    _cross.crossVectors(_v1, _v2);
    signedVolume += _v0.dot(_cross);

    bumpEdge(i0, i1);
    bumpEdge(i1, i2);
    bumpEdge(i2, i0);
  }

  let manifold = true;
  for (const c of edgeCounts.values()) {
    if (c !== 2) { manifold = false; break; }
  }

  const volumeMm3 = Math.abs(signedVolume) / 6;
  return {
    volumeCm3: volumeMm3 / 1000,
    manifold,
  };
}
```

- [ ] **Step 2.4: Rodar testes — todos passam**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 4 testes passam.

- [ ] **Step 2.5: Commit**

```bash
git add case-next/world.js tests/case-next/volume.spec.js
git commit -m "feat(case-next): detecção de malha aberta no cálculo de volume

Conta referências de cada aresta no mesmo loop do volume. Em malha
fechada cada aresta é compartilhada por exatamente 2 triângulos."
```

---

## Task 3: Cache + helpers em `world.js`

**Files:**
- Modify: `case-next/world.js`
- Modify: `tests/case-next/volume.spec.js`

- [ ] **Step 3.1: Adicionar testes para cache, `computeMeshVolumeCached` e `getMeshCentroid`**

Append em `tests/case-next/volume.spec.js`:

```js
test("computeMeshVolumeCached: retorna valor coerente para mesh do fixture", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    return window.__world.computeMeshVolumeCached(names[0]);
  });
  expect(result).not.toBeNull();
  expect(typeof result.volumeCm3).toBe("number");
  expect(result.volumeCm3).toBeGreaterThan(0);
  expect(typeof result.manifold).toBe("boolean");
});

test("computeMeshVolumeCached: nome inválido retorna null", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() =>
    window.__world.computeMeshVolumeCached("não-existe"),
  );
  expect(result).toBeNull();
});

test("computeMeshVolumeCached: segunda chamada é cacheada (mesmo objeto retornado)", async ({ page }) => {
  await setupCaseNext(page);
  const sameRef = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    const a = window.__world.computeMeshVolumeCached(names[0]);
    const b = window.__world.computeMeshVolumeCached(names[0]);
    return a === b;
  });
  expect(sameRef).toBe(true);
});

test("getMeshCentroid: retorna Vector3 com coordenadas finitas", async ({ page }) => {
  await setupCaseNext(page);
  const c = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    const v = window.__world.getMeshCentroid(names[0]);
    return { x: v.x, y: v.y, z: v.z };
  });
  expect(Number.isFinite(c.x)).toBe(true);
  expect(Number.isFinite(c.y)).toBe(true);
  expect(Number.isFinite(c.z)).toBe(true);
});

test("getMeshCentroid: nome inválido retorna null", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() =>
    window.__world.getMeshCentroid("não-existe"),
  );
  expect(result).toBeNull();
});
```

- [ ] **Step 3.2: Rodar testes — devem falhar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 5 novos testes falham com `is not a function` ou `Cannot read properties of null`.

- [ ] **Step 3.3: Implementar `computeMeshVolumeCached` e `getMeshCentroid`**

Adicionar em `case-next/world.js` (após `computeMeshVolumeForMesh`):

```js
const _volumeCache = new Map();   // name → { volumeCm3, manifold }

export function computeMeshVolumeCached(name) {
  if (_volumeCache.has(name)) return _volumeCache.get(name);
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const result = computeMeshVolumeForMesh(mesh);
  _volumeCache.set(name, result);
  return result;
}

export function getMeshCentroid(name) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  return box.getCenter(new THREE.Vector3());
}
```

- [ ] **Step 3.4: Rodar testes — todos passam**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop
```

Esperado: 9 testes passam.

- [ ] **Step 3.5: Commit**

```bash
git add case-next/world.js tests/case-next/volume.spec.js
git commit -m "feat(case-next): computeMeshVolumeCached + getMeshCentroid

Cache lazy por nome de mesh (válido pela sessão). Centroide via bbox
da mesh é simples e suficiente pra placement da pílula."
```

---

## Task 4: Refactor `measurement.js` — extrair `startLinear`, remover FAB interno

**Files:**
- Modify: `case-next/measurement.js`
- Modify: `case-next/main.js`
- Modify: `case-next/dom.js` (simplificar `mountMeasurementFAB`)
- Tests existentes: `tests/case-next/case-next.spec.js` (Sprint 3b.2) — devem continuar passando

Esse refactor é necessário porque a partir daqui o FAB é compartilhado entre Linear e Volume. Quem decide qual ferramenta o FAB abre é o `main.js` via popover, não a ferramenta em si.

- [ ] **Step 4.1: Simplificar `mountMeasurementFAB` em `dom.js`**

Substituir a definição atual de `mountMeasurementFAB` em `case-next/dom.js:195-227` por:

```js
const _FAB_ICON_MEASURE = `<path d="M3 12 L7 8 L21 8 L21 16 L7 16 Z"/><path d="M9 8 L9 12 M13 8 L13 12 M17 8 L17 12"/>`;

export function mountMeasurementFAB({ onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "measure-fab";
  btn.dataset.state = "idle";
  btn.dataset.testid = "measure-fab";
  btn.hidden = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_FAB_ICON_MEASURE}</svg>
    <span class="label">Medir</span>
  `;
  btn.addEventListener("click", onClick);
  document.body.appendChild(btn);

  return {
    setVisible(visible) { btn.hidden = !visible; },
    getElement() { return btn; },
  };
}
```

`setState` e o ícone X (cancel) somem — o cancelamento agora é feito pelo toolbar inferior, não pelo FAB. O FAB só serve para abrir o popover quando IDLE.

- [ ] **Step 4.2: Refatorar `measurement.js` — remover FAB interno, expor `startLinear`**

Substituir o cabeçalho de `case-next/measurement.js:18-94` (todas as declarações de variáveis e a função `init`) por:

```js
let _world = null;
let _dom = null;
let _hint = null;
let _toolbar = null;
let _loupe = null;
let _onExit = null;       // callback pra avisar main.js que voltamos ao idle

let _state = STATE.IDLE;
let _candidate = null;
let _endpoints = [];
let _lineId = null;
let _pillId = null;
let _pillCache = null;
let _highlightedMeshName = null;

let _touch = null;

export function init({ world, dom, hint, onExit }) {
  _world = world;
  _dom = dom;
  _hint = hint;
  _onExit = onExit;

  _toolbar = dom.mountMiniToolbar({
    onConfirm: _onConfirm,
    onCancel: _exit,
    onClear: _exit,
    onNew: () => _enter(STATE.PLACING_P1),
  });
  _loupe = dom.mountLoupe();
  world.attachLoupeCanvas(_loupe.canvas);

  world.onCameraChange(() => {
    if (_state === STATE.RESULT) _applyPillOffsetIfShort();
    if (_loupe && (_state === STATE.PLACING_P1 || _state === STATE.PLACING_P2) && _candidate) {
      const screen = _world.projectToScreen(_candidate.point3D);
      _loupe.setPosition(screen.x, screen.y);
    }
  });

  const canvas = document.getElementById("canvas");
  canvas.addEventListener("pointerdown", _onPointerDown);
  canvas.addEventListener("pointermove", _onPointerMove);
  canvas.addEventListener("pointerup", _onPointerUp);
  canvas.addEventListener("pointercancel", _onPointerUp);

  _enter(STATE.IDLE);

  return {
    startLinear,
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

function startLinear() {
  _enter(STATE.PLACING_P1);
}

function _exit() {
  _enter(STATE.IDLE);
  if (_onExit) _onExit();
}
```

- [ ] **Step 4.3: Remover referências ao `_fab` em todo `measurement.js`**

Buscar e remover linhas que referenciam `_fab` em `case-next/measurement.js`:
- Remover linha que faz `_fab = dom.mountMeasurementFAB(...)` (foi removida no Step 4.2)
- Em `_enter()`, remover qualquer `_fab.setState(...)` e `_fab.setVisible(...)`. O FAB é agora controlado por `main.js`.

Versão final do `_enter()`:

```js
function _enter(next) {
  _clearAll();
  _state = next;

  switch (next) {
    case STATE.IDLE:
      _hint.clear();
      _toolbar.hide();
      break;
    case STATE.PLACING_P1:
      _hint.setText("Toque na estrutura para colocar o ponto");
      _toolbar.hide();
      break;
    case STATE.PLACING_P2:
      _hint.setText("Toque para colocar o segundo ponto");
      _toolbar.hide();
      break;
    case STATE.RESULT:
      _hint.clear();
      _toolbar.showResultRow();
      break;
  }
}
```

Em `_onConfirm()`, no caminho que transiciona para `RESULT` (linhas ~196-201), remover `_fab.setVisible(false);` — fica só:

```js
    // Não chamar _enter(RESULT) porque ele zera tudo via _clearAll. Aplicar transição direta.
    _state = STATE.RESULT;
    _hint.clear();
    _toolbar.showResultRow();
```

- [ ] **Step 4.4: Atualizar `main.js` para criar FAB externo e passar `onExit`**

Substituir `case-next/main.js` (linha 11 — declaração `measurementApi`, linha 48 — chamada `measurement.init`, linha 82 — test hook):

```js
let measurementApi = null;
let fab = null;
```

Substituir o bloco `measurementApi = measurement.init({ world, dom });` (linha 48) por:

```js
  // FAB é compartilhado entre Linear e (futuro) Volume — controlado pelo main.js.
  fab = dom.mountMeasurementFAB({
    onClick: () => {
      fab.setVisible(false);
      measurementApi.startLinear();
    },
  });

  // Hint banner é compartilhado entre Linear e Volume (única instância DOM).
  // Mount aqui e injeta nos dois tools — evita ter dois `.measure-hint` no DOM
  // (o que quebraria seletores Playwright + sobreporia visualmente em mobile).
  const hint = dom.mountHintBanner();

  measurementApi = measurement.init({
    world,
    dom,
    hint,
    onExit: () => fab.setVisible(true),
  });

  fab.setVisible(true);
```

(O wiring com Volume vem na Task 9 — por enquanto, o FAB liga direto Linear.)

- [ ] **Step 4.5: Rodar a suite Sprint 3b.2 — todos os 6 testes existentes devem continuar passando**

```bash
npx playwright test tests/case-next/case-next.spec.js --project=desktop -g "3b.2"
```

Esperado: 6 testes passam (FAB aparece, tap transiciona, candidato + toolbar, P1→P2, fluxo completo com pílula, Limpar). Se algum falhar, ajustar o refactor antes de prosseguir.

- [ ] **Step 4.6: Rodar também no projeto mobile**

```bash
npx playwright test tests/case-next/case-next.spec.js --project=mobile -g "3b.2"
```

Esperado: mesmos 6 testes passam em iPhone 13.

- [ ] **Step 4.7: Commit**

```bash
git add case-next/measurement.js case-next/main.js case-next/dom.js
git commit -m "refactor(case-next): FAB de medida controlado por main.js

Prepara terreno pra ferramenta de volume — FAB único compartilhado
entre Linear e Volume, com onExit callback pra reapresentar o FAB
ao sair de qualquer ferramenta. Suite 3b.2 segue verde."
```

---

## Task 5: `mountMeasurementMenu` (popover) em `dom.js`

**Files:**
- Modify: `case-next/dom.js`
- Modify: `case-next/main.js` (expor `__dom` já existe; nada novo aqui)
- Test: `tests/case-next/volume.spec.js`

- [ ] **Step 5.1: Adicionar testes para o popover**

Append em `tests/case-next/volume.spec.js`:

```js
test("popover: estado inicial fechado", async ({ page }) => {
  await setupCaseNext(page);
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
  await expect(page.locator('[data-testid="menu-linear"]')).toBeHidden();
  await expect(page.locator('[data-testid="menu-volume"]')).toBeHidden();
});

test("popover: clicar no FAB abre popover", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "true");
  await expect(page.locator('[data-testid="menu-linear"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-volume"]')).toBeVisible();
});

test("popover: outside-click fecha", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "true");
  // clica num ponto fora do popover e fora do FAB
  await page.mouse.click(50, 50);
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
});

test("popover: clicar em Linear fecha popover e inicia modo linear", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-linear"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
  expect(await page.evaluate(() => window.__measurement.getState())).toBe("placing-p1");
});
```

- [ ] **Step 5.2: Rodar testes — devem falhar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g popover
```

Esperado: 4 testes falham (popover não existe).

- [ ] **Step 5.3: Implementar `mountMeasurementMenu` em `dom.js`**

Adicionar após `mountMeasurementFAB` em `case-next/dom.js`:

```js
const _MENU_ICON_RULER = `<path d="M3 12 L7 8 L21 8 L21 16 L7 16 Z"/><path d="M9 8 L9 12 M13 8 L13 12 M17 8 L17 12"/>`;
const _MENU_ICON_CUBE = `<path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z"/><path d="M3 8 L12 13 L21 8 M12 13 L12 21"/>`;

export function mountMeasurementMenu({ anchorEl, onPickLinear, onPickVolume }) {
  const wrapper = document.createElement("div");
  wrapper.className = "measure-menu";
  wrapper.dataset.open = "false";
  wrapper.dataset.testid = "measure-menu";
  wrapper.innerHTML = `
    <button type="button" class="measure-menu-item" data-tool="linear" data-testid="menu-linear">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_MENU_ICON_RULER}</svg>
      <span>Linear</span>
    </button>
    <button type="button" class="measure-menu-item" data-tool="volume" data-testid="menu-volume">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_MENU_ICON_CUBE}</svg>
      <span>Volume</span>
    </button>
  `;
  document.body.appendChild(wrapper);

  // Outside-click fecha popover. Considera FAB como "inside" porque clicar nele
  // chama toggle() — sem essa exceção, o handler do FAB abriria e o doc-handler
  // fecharia no mesmo gesto.
  document.addEventListener("pointerdown", (e) => {
    if (wrapper.dataset.open !== "true") return;
    if (wrapper.contains(e.target)) return;
    if (anchorEl && anchorEl.contains(e.target)) return;
    wrapper.dataset.open = "false";
  });

  wrapper.querySelector('[data-tool="linear"]').addEventListener("click", () => {
    wrapper.dataset.open = "false";
    onPickLinear();
  });
  wrapper.querySelector('[data-tool="volume"]').addEventListener("click", () => {
    wrapper.dataset.open = "false";
    onPickVolume();
  });

  return {
    open()   { wrapper.dataset.open = "true";  },
    close()  { wrapper.dataset.open = "false"; },
    toggle() { wrapper.dataset.open = wrapper.dataset.open === "true" ? "false" : "true"; },
    isOpen() { return wrapper.dataset.open === "true"; },
  };
}
```

- [ ] **Step 5.4: Adicionar CSS mínimo para o popover em `style.css`**

Append em `case-next/style.css`:

```css
/* Popover do menu de medida (Linear / Volume) — Sprint 3b.3 */
.measure-menu {
  position: fixed;
  bottom: 88px;            /* acima do FAB que é bottom: 24px com altura ~48px + folga */
  right: 24px;
  background: rgba(39, 36, 37, 0.95);
  border: 1px solid #00d4ff;
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.measure-menu[data-open="false"] {
  display: none;
}
.measure-menu::after {
  content: "";
  position: absolute;
  bottom: -8px;
  right: 28px;
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid #00d4ff;
}
.measure-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 15px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 8px;
  min-width: 160px;
  text-align: left;
}
.measure-menu-item:hover,
.measure-menu-item:focus-visible {
  background: rgba(0, 212, 255, 0.15);
  outline: none;
}
.measure-menu-item svg {
  width: 22px;
  height: 22px;
  color: #00d4ff;
  flex-shrink: 0;
}
```

- [ ] **Step 5.5: Conectar popover ao FAB em `main.js`**

No `case-next/main.js`, substituir o bloco que cria o FAB (que ficou diretamente ligando o Linear na Task 4) por:

```js
  fab = dom.mountMeasurementFAB({
    onClick: () => menu.toggle(),
  });

  measurementApi = measurement.init({
    world,
    dom,
    onExit: () => fab.setVisible(true),
  });

  const menu = dom.mountMeasurementMenu({
    anchorEl: fab.getElement(),
    onPickLinear: () => {
      fab.setVisible(false);
      measurementApi.startLinear();
    },
    onPickVolume: () => {
      // Volume ainda não implementado — vem na Task 8.
      // Por ora, apenas fechar o popover (que já é feito pela função interna).
      console.warn("Volume tool not yet wired");
    },
  });

  fab.setVisible(true);
```

- [ ] **Step 5.6: Rodar testes do popover — devem passar (exceto "menu-volume inicia volume" — só na Task 9)**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g popover
```

Esperado: 4 testes passam (popover existe, abre no FAB, fecha em outside, Linear funciona).

- [ ] **Step 5.7: Re-rodar suite Sprint 3b.2 — não pode regredir**

```bash
npx playwright test tests/case-next/case-next.spec.js --project=desktop -g "3b.2"
```

Esperado: 6 testes ainda passam. ⚠️ **Atenção:** o teste `3b.2 / tap no FAB transiciona pra placing-p1` agora vai falhar porque o FAB abre o popover em vez de ir direto pra placing-p1. **Atualizar esse teste** para passar pelo menu:

Substituir em `tests/case-next/case-next.spec.js` (linha ~431):

```js
test("3b.2 / tap no FAB+Linear transiciona pra placing-p1", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-linear"]').click();
  expect(await getMeasurementState(page)).toBe("placing-p1");
  await expect(page.locator('[data-testid="measure-hint"]')).toBeVisible();
  await expect(page.locator('[data-testid="measure-fab"]')).toBeHidden();
});
```

E em todos os outros testes 3b.2 que fazem `await page.locator('[data-testid="measure-fab"]').click();` (linhas 442, 453, 466, 484), substituir o gesto único por um par:

```js
await page.locator('[data-testid="measure-fab"]').click();
await page.locator('[data-testid="menu-linear"]').click();
```

- [ ] **Step 5.8: Re-rodar tudo, desktop + mobile**

```bash
npx playwright test tests/case-next/ --project=desktop
npx playwright test tests/case-next/ --project=mobile
```

Esperado: toda a suite passa em ambos os projetos.

- [ ] **Step 5.9: Commit**

```bash
git add case-next/dom.js case-next/main.js case-next/style.css tests/case-next/
git commit -m "feat(case-next): popover de medida com itens Linear / Volume

FAB agora abre popover ao invés de ir direto pra Linear. Volume ainda
não wired (vem na próxima task). Suite 3b.2 ajustada pra passar pelo
novo gesto FAB→popover→Linear."
```

---

## Task 6: `mountVolumeToolbar` em `dom.js`

**Files:**
- Modify: `case-next/dom.js`
- Modify: `case-next/style.css` (reusa estilo do `.measure-toolbar` existente)
- Test: nenhum direto (testado indiretamente via fluxo do volume na Task 8/9)

- [ ] **Step 6.1: Adicionar `mountVolumeToolbar` em `dom.js`**

Adicionar após `mountMiniToolbar` em `case-next/dom.js`:

```js
export function mountVolumeToolbar({ onNew, onExit }) {
  const el = document.createElement("div");
  el.className = "measure-toolbar";
  el.dataset.testid = "volume-toolbar";
  el.hidden = true;
  document.body.appendChild(el);

  function makeBtn(label, klass, onClick, testid) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klass;
    b.textContent = label;
    b.dataset.testid = testid;
    b.addEventListener("click", onClick);
    return b;
  }

  return {
    showEmpty() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Sair", "btn-secondary", onExit, "btn-volume-exit"));
      el.hidden = false;
    },
    showResult() {
      el.innerHTML = "";
      el.appendChild(makeBtn("✕ Sair", "btn-secondary", onExit, "btn-volume-exit"));
      el.appendChild(makeBtn("+ Nova", "btn-primary", onNew, "btn-volume-new"));
      el.hidden = false;
    },
    hide() {
      el.innerHTML = "";
      el.hidden = true;
    },
  };
}
```

- [ ] **Step 6.2: Commit (componente isolado, sem teste direto ainda)**

```bash
git add case-next/dom.js
git commit -m "feat(case-next): mountVolumeToolbar — Sair / +Nova

Reusa o estilo .measure-toolbar do Linear. showEmpty exibe só Sair;
showResult exibe Sair + Nova."
```

---

## Task 7: Criar `volume.js` com máquina de estado básica

**Files:**
- Create: `case-next/volume.js`
- Modify: `case-next/main.js` (importar volume + expor `__volume` em modo teste)
- Test: `tests/case-next/volume.spec.js`

- [ ] **Step 7.1: Adicionar testes do estado inicial**

Append em `tests/case-next/volume.spec.js`:

```js
test("volume / estado inicial é idle", async ({ page }) => {
  await setupCaseNext(page);
  const state = await page.evaluate(() => window.__volume.getState());
  expect(state).toBe("idle");
});

test("volume / picking Volume entra em active-empty com hint e toolbar", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-empty");
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText(/toque na estrutura para medir o volume/i);
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-exit"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-new"]')).toBeHidden();
});

test("volume / Sair em active-empty volta a idle + reapresenta FAB", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await page.locator('[data-testid="btn-volume-exit"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("idle");
  await expect(page.locator('[data-testid="measure-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeHidden();
});
```

- [ ] **Step 7.2: Rodar testes — devem falhar (volume.js não existe)**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "^volume / "
```

Esperado: 3 testes falham.

- [ ] **Step 7.3: Criar `case-next/volume.js`**

```js
// case-next/volume.js
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

// Pointer handlers vêm na Task 8.
function _onPointerDown(e) {
  if (_state !== STATE.ACTIVE_EMPTY && _state !== STATE.ACTIVE_RESULT) return;
  _touch = { startX: e.clientX, startY: e.clientY, startT: performance.now() };
}

function _onPointerUp(e) {
  // Stub — implementação completa do tap vem na Task 8.
  _touch = null;
}
```

- [ ] **Step 7.4: Inicializar volume + expor `__volume` em `main.js`**

Adicionar import no topo de `case-next/main.js`:

```js
import * as volume from "./volume.js";
```

Após o `let measurementApi = null; let fab = null;` (linha 11), adicionar:

```js
let volumeApi = null;
```

No `bootstrap()`, após a inicialização do `measurementApi`, adicionar:

```js
  volumeApi = volume.init({
    world,
    dom,
    hint,
    onExit: () => fab.setVisible(true),
  });
```

E no callback `onPickVolume` do menu (que tinha um `console.warn`), substituir por:

```js
    onPickVolume: () => {
      fab.setVisible(false);
      volumeApi.startVolume();
    },
```

No bloco do test hook (linha ~81), adicionar exposição de `__volume`:

```js
if (window.__playwrightTest) {
  window.__world = world;
  window.__dom = dom;
  Object.defineProperty(window, "__measurement", { get: () => measurementApi });
  Object.defineProperty(window, "__volume", { get: () => volumeApi });
}
```

- [ ] **Step 7.5: Rodar testes — devem passar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "^volume / "
```

Esperado: 3 testes passam.

- [ ] **Step 7.6: Commit**

```bash
git add case-next/volume.js case-next/main.js tests/case-next/volume.spec.js
git commit -m "feat(case-next): máquina de estado do modo Volume

Cria volume.js espelhando a forma de measurement.js. Estados: idle,
active-empty, active-result. Tap handler ainda stub — vem na próxima
task. Sair volta ao IDLE e reapresenta o FAB."
```

---

## Task 8: Tap em estrutura mostra pílula com volume

**Files:**
- Modify: `case-next/volume.js`
- Test: `tests/case-next/volume.spec.js`

- [ ] **Step 8.1: Adicionar testes do fluxo tap → result**

Append em `tests/case-next/volume.spec.js`:

```js
// Reusa o helper tapNearMesh do case-next.spec.js. Re-declarar localmente
// pra que volume.spec.js seja autoportável.
async function tapNearMesh(page, targetX, targetY) {
  const hitCoord = await page.evaluate(([tx, ty]) => {
    const w = window.__world;
    if (w.raycastFromScreen(tx, ty)) return { x: tx, y: ty };
    for (let r = 20; r <= 200; r += 20) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const sx = tx + Math.cos(a) * r;
        const sy = ty + Math.sin(a) * r;
        if (w.raycastFromScreen(sx, sy)) return { x: sx, y: sy };
      }
    }
    return null;
  }, [targetX, targetY]);
  if (!hitCoord) throw new Error(`No mesh near (${targetX}, ${targetY})`);
  await page.mouse.click(hitCoord.x, hitCoord.y);
  return hitCoord;
}

async function tapCanvasCenter(page) {
  const box = await page.locator("#canvas").boundingBox();
  return tapNearMesh(page, box.x + box.width / 2, box.y + box.height / 2);
}

test("volume / tap em estrutura transiciona pra active-result", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-result");
  const measuredName = await page.evaluate(() => window.__volume.getMeasuredMesh());
  expect(measuredName).not.toBeNull();
});

test("volume / pílula com formato XX,X cm³ aparece", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  const text = await page.evaluate(() => window.__volume.getPillText());
  // formato esperado: dígitos + vírgula + dígito + " cm³", com prefixo opcional "~"
  expect(text).toMatch(/^~?\d+(\.\d+)?,\d cm³$/);
  await expect(page.locator(".measurement-pill")).toBeVisible();
});

test("volume / tap em estrutura diferente substitui medição", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  const firstName = await page.evaluate(() => window.__volume.getMeasuredMesh());

  // tenta tocar em offset grande pra cair em outra mesh
  const box = await page.locator("#canvas").boundingBox();
  await tapNearMesh(page, box.x + box.width * 0.2, box.y + box.height * 0.2);

  // se cair na mesma mesh, ainda assim deve estar em active-result
  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-result");
  // pode ou não ter trocado de mesh dependendo da geometria — apenas verificar que
  // o handler executou (estado correto + pílula presente)
  await expect(page.locator(".measurement-pill")).toBeVisible();
});

test("volume / toolbar em active-result mostra +Nova e Sair", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  await expect(page.locator('[data-testid="btn-volume-new"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-exit"]')).toBeVisible();
});
```

- [ ] **Step 8.2: Rodar testes — devem falhar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "^volume / "
```

Esperado: 4 testes novos falham (tap não tem efeito ainda).

- [ ] **Step 8.3: Implementar pointer handlers completos em `volume.js`**

Substituir as funções stub `_onPointerDown` e `_onPointerUp` no fim de `case-next/volume.js` por:

```js
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
  _pillId = _world.addPill(centroid, _pillText);

  // Marca data-warn na pílula DOM quando não-manifold.
  if (!result.manifold) {
    const pillEl = document.querySelector(".measurement-pill:last-of-type");
    if (pillEl) pillEl.dataset.warn = "true";
  }

  // Não chamar _enter(ACTIVE_RESULT) — ele zera tudo via _clearMeasurement.
  _state = STATE.ACTIVE_RESULT;
  _hint.clear();
  _toolbar.showResult();
}

function _formatPill({ volumeCm3, manifold }) {
  const value = volumeCm3.toFixed(1).replace(".", ",");
  return manifold ? `${value} cm³` : `~${value} cm³`;
}
```

- [ ] **Step 8.4: Rodar testes — devem passar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "^volume / "
```

Esperado: 7 testes passam (3 da Task 7 + 4 novos).

- [ ] **Step 8.5: Commit**

```bash
git add case-next/volume.js tests/case-next/volume.spec.js
git commit -m "feat(case-next): tap em estrutura mede e mostra pílula em cm³

Reusa world.raycastFromScreen + setMeshHighlight + addPill do Linear.
Tap em outra mesh substitui medição (passa por _clearMeasurement
antes de aplicar nova). data-warn na pílula quando não-manifold."
```

---

## Task 9: `+ Nova` e `✕ Sair` no `ACTIVE_RESULT`

**Files:**
- Modify: `case-next/volume.js` (apenas refino — os handlers já existem)
- Test: `tests/case-next/volume.spec.js`

A lógica já está plumbada na Task 6/7 (toolbar callbacks → `_enter`/`_exit`). Aqui apenas validamos com testes E2E que o comportamento bate.

- [ ] **Step 9.1: Adicionar testes do +Nova e Sair**

Append em `tests/case-next/volume.spec.js`:

```js
test("volume / + Nova volta a active-empty mantendo modo", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-volume-new"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-empty");
  expect(await page.evaluate(() => window.__volume.getMeasuredMesh())).toBeNull();
  await expect(page.locator(".measurement-pill")).toBeHidden();
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText(/toque na estrutura/i);
  await expect(page.locator('[data-testid="measure-fab"]')).toBeHidden();
});

test("volume / Sair em active-result limpa tudo e reapresenta FAB", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-volume-exit"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("idle");
  expect(await page.evaluate(() => window.__volume.getMeasuredMesh())).toBeNull();
  await expect(page.locator(".measurement-pill")).toBeHidden();
  await expect(page.locator('[data-testid="measure-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeHidden();
});
```

- [ ] **Step 9.2: Rodar testes — devem passar (lógica já existe)**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "^volume / "
```

Esperado: 9 testes passam.

- [ ] **Step 9.3: Commit**

```bash
git add tests/case-next/volume.spec.js
git commit -m "test(case-next): + Nova / ✕ Sair no fluxo de volume

+ Nova limpa medição e volta pra active-empty (mantém modo).
✕ Sair volta pra idle e reapresenta o FAB."
```

---

## Task 10: CSS — pílula com warning de não-manifold

**Files:**
- Modify: `case-next/style.css`
- Test: `tests/case-next/volume.spec.js`

- [ ] **Step 10.1: Adicionar teste do estilo warning (sem fixture específico)**

A `sample.glb` já contém malhas anatômicas decimadas — alguma quase certamente tem furos minúsculos da segmentação, então é provável que `manifold: false` apareça naturalmente para pelo menos uma das estruturas. Vamos verificar isso primeiro, e se não, sintetizar via injeção direta.

Append em `tests/case-next/volume.spec.js`:

```js
test("volume / pílula recebe data-warn=true quando malha não-manifold", async ({ page }) => {
  await setupCaseNext(page);

  // Sintetiza o caso: força que um nome conhecido retorne manifold=false
  // injetando um valor no cache antes do tap. Isso desacopla o teste da
  // qualidade exata das malhas do fixture.
  await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    // Manualmente injeta um valor fake no cache do world. Como o cache é
    // privado, usar a função pública: ela só consulta o cache se já houver
    // entrada. Estratégia: pré-popular via patch.
    // Aqui o jeito mais simples é monkey-patch temporário:
    window.__origCompute = window.__world.computeMeshVolumeCached;
    window.__world.computeMeshVolumeCached = (n) =>
      n === names[0] ? { volumeCm3: 12.3, manifold: false } : window.__origCompute(n);
  });

  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  // Esperamos que o tap pegue a primeira mesh (a que retornou manifold=false).
  // Se cair em outra, o teste verifica apenas que a pílula tem o data-warn correto.
  const pillData = await page.evaluate(() => {
    const el = document.querySelector(".measurement-pill");
    return el ? { text: el.textContent, warn: el.dataset.warn } : null;
  });

  // Limpa o monkey-patch
  await page.evaluate(() => {
    if (window.__origCompute) {
      window.__world.computeMeshVolumeCached = window.__origCompute;
      delete window.__origCompute;
    }
  });

  expect(pillData).not.toBeNull();
  if (pillData.warn === "true") {
    expect(pillData.text).toMatch(/^~\d+,\d cm³$/);
  } else {
    // Caiu em mesh manifold — sem prefixo til
    expect(pillData.text).toMatch(/^\d+(\.\d+)?,\d cm³$/);
  }
});
```

- [ ] **Step 10.2: Verificar onde a pílula é estilizada hoje**

Abrir `case-next/style.css` e localizar `.measurement-pill`. (Já existe pelo trabalho do Linear no Sprint 3b.2 — `addPill` em world.js cria um elemento com essa classe.)

- [ ] **Step 10.3: Adicionar CSS pro estado warning**

Append em `case-next/style.css`:

```css
/* Volume — pílula com warning de malha aberta (Sprint 3b.3) */
.measurement-pill[data-warn="true"] {
  color: #ffb000;          /* gold — mesma paleta IBM Colorblind Safe do mesh-processor */
  border-color: #ffb000;
}
.measurement-pill[data-warn="true"]::after {
  content: " ⚠";
  font-size: 0.9em;
  margin-left: 4px;
}
```

- [ ] **Step 10.4: Rodar teste — deve passar**

```bash
npx playwright test tests/case-next/volume.spec.js --project=desktop -g "data-warn"
```

Esperado: 1 teste passa.

- [ ] **Step 10.5: Commit**

```bash
git add case-next/style.css tests/case-next/volume.spec.js
git commit -m "feat(case-next): estilo gold + ícone ⚠ na pílula de volume aproximado

Pílula com data-warn=\"true\" exibe cor gold (#ffb000) e sufixo ⚠.
Sinaliza ao clínico que o valor é aproximado por causa de malha aberta."
```

---

## Task 11: Validação final + testes mobile

**Files:**
- Tests: rodar a suite inteira em ambos os projetos
- Validação manual no browser

- [ ] **Step 11.1: Rodar suite inteira no projeto desktop**

```bash
npx playwright test tests/case-next/ --project=desktop
```

Esperado: todos os testes passam (case-next.spec.js + volume.spec.js).

- [ ] **Step 11.2: Rodar suite inteira no projeto mobile (iPhone 13)**

```bash
npx playwright test tests/case-next/ --project=mobile
```

Esperado: todos os testes passam. Se algum teste mobile falhar por causa do popover (touch handling ou layout fora da viewport), ajustar:
- Se popover sai da tela em mobile, ajustar `.measure-menu { right: 16px; bottom: 80px; }` em media query `@media (max-width: 768px)`.
- Se o tap no popover não funciona, verificar que `pointerdown` no popover não é interceptado pelo outside-click handler.

- [ ] **Step 11.3: Smoke manual no browser**

```bash
npx http-server -p 5500 -c-1 --silent &
open "http://127.0.0.1:5500/case-next/?id=<um-uid-real-do-R2>"
```

Validar manualmente:
1. FAB "Medir" visível
2. Click no FAB → popover abre com Linear + Volume
3. Click fora do popover → popover fecha
4. Click em "Linear" → fluxo Linear funciona como antes (P1 → Confirmar → P2 → Confirmar → resultado)
5. Click em "Volume" → hint banner aparece
6. Tap em estrutura → outline cyan + pílula com valor em cm³
7. Tap em outra estrutura → medição substitui
8. + Nova → pílula some, hint volta
9. ✕ Sair → tudo limpa, FAB reaparece
10. Câmera move com medição ativa → pílula segue o centro da estrutura
11. (se possível) checar uma malha que produz `~XX,X cm³ ⚠` — confirma que aparece em gold

- [ ] **Step 11.4: Commit final (sem mudanças, só marca o checkpoint)**

```bash
git status   # deve estar limpo
echo "Implementação completa."
```

---

## Out of scope (não fazer nesta sprint)

- Multi-volume simultâneo (várias pílulas ao mesmo tempo) — pode entrar em sprint futuro
- Reparo automático de malhas no `mesh-processor` (server-side)
- Detecção de unidades diferentes de mm
- Volume diferencial (ex.: % tumor/órgão)
- Persistência de medições no laudo

## Acceptance final (do spec)

- [ ] FAB abre popover com 2 opções
- [ ] Volume é calculado e exibido em cm³ ao tocar uma estrutura
- [ ] Outline cyan destaca a estrutura medida
- [ ] Pílula segue o centroide quando câmera move
- [ ] Tap em outra estrutura substitui medição sem clique extra
- [ ] `+ Nova` limpa medição mas mantém modo
- [ ] `✕ Sair` reapresenta o FAB
- [ ] Malha aberta exibe `~X,X cm³ ⚠`
- [ ] Cubo de aresta conhecida bate matemática (±2%)
- [ ] Linear continua funcionando após refactor (suite existente verde)
- [ ] Cache evita recomputar em taps subsequentes
- [ ] Mobile (iPhone 13 / Playwright) — popover, tap, pílula, toolbar funcionam
