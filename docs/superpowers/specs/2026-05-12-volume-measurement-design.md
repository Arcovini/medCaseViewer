# Medição de Volume — case-next

## Objetivo

Adicionar uma segunda ferramenta de medição ao viewer `case-next`: **Volume**. O clínico escolhe entre `📏 Linear` (existente) e `📦 Volume` (novo) num popover ancorado ao FAB de medida. Ao selecionar Volume e tocar em uma estrutura, o valor do volume da malha é exibido em `cm³`, com indicação visual quando a malha não é fechada (não-manifold).

Escopo: somente `case-next/`. O viewer Sketchfab antigo em `case/` não é tocado (não tem acesso à geometria das malhas).

## Decisões de design (resumo)

| Tópico | Decisão |
|---|---|
| Método de cálculo | Soma de tetraedros sinalizados sobre os triângulos da malha (volume real) |
| Unidade | `cm³` fixa, formato PT-BR (`12,3 cm³`) |
| Menu | Popover ancorado ao FAB, abre ao tocar nele; itens Linear / Volume |
| Workflow | Tap imediato — sem botão Confirmar (não há nada pra refinar) |
| Multi-medição | Uma estrutura por vez; tocar em outra substitui |
| Lifetime | Apenas enquanto o modo Volume está ativo; sair limpa tudo |
| Câmera move | Não apaga (volume independe da câmera) |
| Malha aberta | Soft warning: pílula mostra `~12,3 cm³ ⚠️` + tooltip |
| Cache | Lazy, por nome de mesh, válido pela sessão |

## Arquitetura

### Estado e responsabilidades

```
main.js
  ├─ measurement.js (Linear — existente, com pequena refatoração no entry-point)
  └─ volume.js     (Volume — novo, espelha a forma de measurement.js)

  ambos consomem:
  ├─ world.js  (Three.js — adições: computeMeshVolumeCached, getMeshCentroid)
  └─ dom.js    (UI primitives — adições: mountMeasurementMenu, mountVolumeToolbar)
```

Cada ferramenta tem sua própria máquina de estado e gerencia seus próprios objetos visuais. Apenas uma ferramenta ativa por vez. O FAB único atual vira o trigger do popover que liga uma ou outra.

### Volume — máquina de estado

```
                  ┌────────┐  pickVolume()  ┌──────────────┐
                  │  IDLE  │ ─────────────▶ │ ACTIVE_EMPTY │
                  └────────┘                └──────┬───────┘
                       ▲                           │  tap estrutura
                       │                           ▼
                  onExit  ◀────────────── ┌────────────────┐
                       │      ✕ Sair      │ ACTIVE_RESULT  │ ◀──┐
                       │                  └────────┬───────┘    │ tap outra
                       │                           │            │ estrutura
                       │                           └────────────┘
                       │
                       │ ✕ Sair (do ACTIVE_RESULT também)
                       │
                       └ ── (a partir de qualquer estado ativo)

  + Nova: ACTIVE_RESULT → ACTIVE_EMPTY (limpa pílula e outline, mantém modo)
```

Transições:
- **IDLE → ACTIVE_EMPTY**: usuário escolhe "Volume" no popover do FAB.
- **ACTIVE_EMPTY → ACTIVE_RESULT**: tap em mesh (raycast hit).
- **ACTIVE_RESULT → ACTIVE_RESULT** (mesh diferente): tap em outra mesh — substitui sem passar por intermediário.
- **ACTIVE_RESULT → ACTIVE_EMPTY**: clique em `+ Nova`. Remove pílula e outline, hint volta.
- **qualquer ativo → IDLE**: clique em `✕ Sair`. Remove tudo, FAB reaparece.
- Tap em vácuo (raycast miss): ignorado silenciosamente.
- Câmera move: ignorado pela máquina de estado (medição persiste). Pílula segue o centroide via CSS2DObject como o Linear.

### UI states

| Estado | FAB | Popover | Hint banner | Toolbar inferior | Outline na mesh | Pílula |
|---|---|---|---|---|---|---|
| `IDLE` | visível | fechado | escondido | escondido | não | não |
| `IDLE` + tap no FAB | visível | aberto | escondido | escondido | não | não |
| `ACTIVE_EMPTY` | escondido | fechado | "Toque na estrutura para medir o volume" | `✕ Sair` | não | não |
| `ACTIVE_RESULT` | escondido | fechado | escondido | `+ Nova` + `✕ Sair` | sim (cyan, OutlinePass) | sim |

## Cálculo do volume

### Algoritmo

Volume de uma malha fechada via soma de tetraedros sinalizados sobre o origem:

```
V = (1/6) · | Σᵢ ( v0ᵢ · (v1ᵢ × v2ᵢ) ) |
```

Onde `v0, v1, v2` são os vértices de cada triângulo `i` em **coordenadas de mundo** (após `mesh.matrixWorld`).

```js
function computeMeshVolume(mesh) {
  mesh.updateMatrixWorld();
  const matrix = mesh.matrixWorld;
  const positions = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  let signedVolume = 0;
  const triCount = index ? index.count / 3 : positions.count / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3)     : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    v0.fromBufferAttribute(positions, i0).applyMatrix4(matrix);
    v1.fromBufferAttribute(positions, i1).applyMatrix4(matrix);
    v2.fromBufferAttribute(positions, i2).applyMatrix4(matrix);

    cross.crossVectors(v1, v2);
    signedVolume += v0.dot(cross);
  }

  return Math.abs(signedVolume) / 6;
}
```

Resultado em unidades³ do mundo. O viewer assume mundo em milímetros (consistente com o `measurement.js` que reporta distâncias em mm), portanto `volumeMm3 = result` e `volumeCm3 = result / 1000`.

### Manifold check (mesmo loop)

Para cada triângulo, registra suas 3 arestas como pares ordenados de índices de vértice. Em malha fechada cada aresta é referenciada por exatamente 2 triângulos. Se alguma aresta tem ≠ 2 referências (ou se há triângulos não-coplanares compartilhando aresta com orientações inconsistentes), a malha é aberta.

```js
const edgeCounts = new Map();   // key: (a << 21) | b  (a < b, índices até 2^21)
function bump(a, b) {
  const k = a < b ? (a * 0x200000 + b) : (b * 0x200000 + a);
  edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
}
// dentro do loop de triângulos:
bump(i0, i1); bump(i1, i2); bump(i2, i0);
// após o loop:
let manifold = true;
for (const c of edgeCounts.values()) if (c !== 2) { manifold = false; break; }
```

Limite de índices: 2^21 = 2.097.152 vértices. Os modelos pós-decimação têm ≤ 300k triângulos (≤ 900k índices), bem abaixo. Se algum dia ultrapassar, usar string key `${a},${b}` (custo ~2x, ainda aceitável).

### Cache

```js
const volumeCache = new Map();  // name → { volumeCm3, manifold }

export function computeMeshVolumeCached(name) {
  if (volumeCache.has(name)) return volumeCache.get(name);
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const result = _computeVolumeAndManifold(mesh);
  volumeCache.set(name, result);
  return result;
}
```

Invalidação: nunca durante a sessão (geometria é imutável após `mount()`). Limpar com `clearVolumeCache()` se um dia houver swap de modelo — não há esse fluxo hoje.

### Centroide para a pílula

```js
export function getMeshCentroid(name) {
  const mesh = namedMeshes.get(name);
  if (!mesh) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  return box.getCenter(new THREE.Vector3());
}
```

Centro da bounding box é simples, suficientemente preciso pra label flutuante, e barato (`setFromObject` já é usado em `frameToScene`). Centroide ponderado por área de triângulo seria mais "correto" mas a diferença visual é desprezível e o custo extra não compensa.

### Performance

Custo estimado por mesh (cálculo + manifold check, num único loop):
- ~280 operações × N triângulos.
- 200k triângulos × 280 ops ≈ 56M ops ≈ ~10ms em um celular moderno (~5 GFLOPS efetivos).
- Memória temporária: `edgeCounts` Map com ~3×N entradas → ~10-20 MB para N=200k. GC'ado após o cálculo.

Lazy (compute on first tap) e cacheado. Tap subsequente na mesma mesh é O(1).

## Mudanças por arquivo

### Novo: `case-next/volume.js`

Espelha a forma do `measurement.js`:

```js
const STATE = Object.freeze({
  IDLE: "idle",
  ACTIVE_EMPTY: "active-empty",
  ACTIVE_RESULT: "active-result",
});

let _state = STATE.IDLE;
let _measuredMeshName = null;
let _pillId = null;
let _world, _dom, _hint, _toolbar;

export function init({ world, dom, onExit }) { ... }
export function startVolume() { ... }   // chamado pelo popover do menu
function _onTap(screenX, screenY) { ... }
function _enter(next) { ... }
function _clearMeasurement() { ... }    // remove pill + outline (mantém modo)
function _exit() { ... onExit(); }      // sai para IDLE + reapresenta FAB
```

Reusa `world.raycastFromScreen`, `world.setMeshHighlight`, `world.addPill`, `world.removePill`. Listeners de pointer no canvas (mesmo padrão do `measurement.js`). Detecção tap-vs-drag com mesmos thresholds (TAP_THRESHOLD_PX=15, TAP_THRESHOLD_MS=500).

Formato do texto da pílula:
```js
function _formatPill({ volumeCm3, manifold }) {
  const value = volumeCm3.toFixed(1).replace(".", ",");
  return manifold ? `${value} cm³` : `~${value} cm³`;
}
```

Quando não-manifold, adiciona atributo `data-warn="true"` no elemento da pílula para o CSS exibir o ícone ⚠️ e mudar a cor.

### `case-next/world.js` — adições

Sem alterar nada existente, adicionar:
- `computeMeshVolumeCached(name) → { volumeCm3, manifold } | null`
- `getMeshCentroid(name) → Vector3 | null`

O `setMeshHighlight`, `addPill`, `removePill`, `updatePill` já existem e são reusados sem mudança.

### `case-next/dom.js` — mudanças

**Refatorar `mountMeasurementFAB`:** o FAB hoje tem callback `onStart` + `onCancel`. Vamos generalizar:

```js
export function mountMeasurementFAB({ onClick }) {
  // ... mantém ícone genérico (régua) — popover mostra as opções
  btn.addEventListener("click", onClick);
  return { setVisible(visible) { btn.hidden = !visible; } };
}
```

`onClick` é o trigger do popover. O FAB agora só liga/desliga; durante mode ativo o FAB fica escondido (`setVisible(false)`).

**Nova `mountMeasurementMenu`:** cria popover fechado por padrão. Ancorado bottom-right (alinhado ao FAB) com um pequeno triangle pointer apontando para baixo. Dois `<button>` empilhados.

```js
export function mountMeasurementMenu({ onPickLinear, onPickVolume }) {
  const wrapper = document.createElement("div");
  wrapper.className = "measure-menu";
  wrapper.dataset.open = "false";
  wrapper.innerHTML = `
    <button type="button" class="measure-menu-item" data-tool="linear" data-testid="menu-linear">
      <svg ...ruler icon...></svg> Linear
    </button>
    <button type="button" class="measure-menu-item" data-tool="volume" data-testid="menu-volume">
      <svg ...cube icon...></svg> Volume
    </button>
  `;
  document.body.appendChild(wrapper);
  // outside-click: fecha popover
  document.addEventListener("pointerdown", (e) => {
    if (wrapper.dataset.open === "true" && !wrapper.contains(e.target) && !fabEl.contains(e.target)) {
      wrapper.dataset.open = "false";
    }
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
    open()  { wrapper.dataset.open = "true";  },
    close() { wrapper.dataset.open = "false"; },
    toggle(){ wrapper.dataset.open = wrapper.dataset.open === "true" ? "false" : "true"; },
  };
}
```

**Nova `mountVolumeToolbar`:** parecida com `mountMiniToolbar` do Linear, mas com botões específicos do Volume.

```js
export function mountVolumeToolbar({ onNew, onExit }) {
  // dois rows possíveis: empty (só Sair) e result (Nova + Sair)
  return { showEmpty(), showResult(), hide() };
}
```

**Reusar `mountHintBanner`:** já é genérico, sem mudança.

### `case-next/main.js` — wiring

Dentro do bloco que inicializa `measurement.init(...)`, adicionar inicialização do volume e do menu:

```js
import * as measurement from "./measurement.js";
import * as volume from "./volume.js";

// dentro de init, após mount:
const fab = dom.mountMeasurementFAB({
  onClick: () => menu.toggle(),
});

const onExitToIdle = () => fab.setVisible(true);

const linearAPI = measurement.init({ world, dom, onExit: onExitToIdle });
const volumeAPI = volume.init({ world, dom, onExit: onExitToIdle });

const menu = dom.mountMeasurementMenu({
  onPickLinear: () => { fab.setVisible(false); linearAPI.startLinear(); },
  onPickVolume: () => { fab.setVisible(false); volumeAPI.startVolume(); },
});

fab.setVisible(true);
```

Refatoração necessária no `measurement.js`: extrair o entry-point atual (`_enter(STATE.PLACING_P1)` no callback do `_fab.onStart`) para uma função `startLinear()` exportada via `init()`. O FAB interno do `measurement.js` é removido — o FAB global é gerenciado pelo `main.js`. Resto da lógica fica idêntica.

### `case-next/style.css` — visual

- `.measure-menu` — `position: fixed`, ancorado bottom-right alinhado ao FAB. Card cyan-borda: `background: rgba(39, 36, 37, 0.95); border: 1px solid #00d4ff; border-radius: 12px; backdrop-filter: blur(8px);`. Pseudo-element `::after` cria o triangle pointer apontando pra baixo.
- `.measure-menu[data-open="false"]` — `display: none`.
- `.measure-menu-item` — flex row, ícone + texto, hover state com background `rgba(0, 212, 255, 0.15)`.
- `.measurement-pill[data-warn="true"]` — adiciona ícone `⚠️` como `::after`, cor da pílula muda de cyan para `#ffb000` (gold, consistente com a paleta de fallback de cores do mesh-processor).

## Testes

Adicionar `tests/case-next/volume.spec.js` (Playwright):

| # | Comportamento | Como testar |
|---|---|---|
| 1 | Popover abre ao clicar FAB | Click no FAB, assert `[data-testid="menu-linear"]` e `[data-testid="menu-volume"]` visíveis |
| 2 | Outside-click fecha popover | Click no canvas (fora do popover), assert popover fechado |
| 3 | Picking "Volume" entra em ACTIVE_EMPTY | Click "Volume", assert hint banner com texto "Toque na estrutura..." + toolbar com "Sair" visível |
| 4 | Tap em mesh mostra pílula | Mock `raycastFromScreen` ou tap em coord conhecida, assert pílula visível com regex `/^\d+,\d cm³$/` |
| 5 | Outline aparece na mesh tocada | Assert `world.outlinePass.selectedObjects.length === 1` via instrumentação ou screenshot |
| 6 | Tap em outra mesh substitui medição | Tap em A, tap em B, assert texto da pílula mudou |
| 7 | `+ Nova` limpa medição, mantém modo | Click "Nova", assert pílula sumiu mas hint banner ainda visível |
| 8 | `✕ Sair` limpa tudo e reapresenta FAB | Click "Sair", assert FAB visível, hint banner e pílula sumiram |
| 9 | Volume de cubo bate matemática | Fixture: GLB com cubo de aresta conhecida. Tap no cubo, parse pílula, assert valor dentro de ±2% do esperado |
| 10 | Mesh não-manifold mostra warning | Fixture com STL com furo. Assert pílula tem prefixo `~` e `data-warn="true"` |
| 11 | Linear continua funcionando após refactor | Rodar suite existente de `measurement.spec.js` — todos passam |

Mobile: o projeto Playwright `mobile` (iPhone 13) roda toda a suite — adicionar `volume.spec.js` cobre mobile automaticamente.

**Fixture do cubo:** GLB simples com um cubo de 10mm de aresta. Volume esperado: 1.000 mm³ = 1,0 cm³. Gerar manualmente em código (Three.js exporter) ou adicionar ao `tests/case-next/fixtures/`.

**Fixture com furo:** STL de teste com 1 face removida (visualmente fechado pra raycast, mas não-manifold). Gerar via trimesh em script de pré-teste.

## Out of scope

- Multi-volume simultâneo (várias pílulas na tela ao mesmo tempo). Adicionar em sprint futuro se houver demanda.
- Reparo automático de malhas abertas (`mesh.fill_holes()` do trimesh seria server-side). Por enquanto, soft warning no frontend.
- Detecção de unidades diferentes de mm. O viewer assume mm consistente com o `measurement.js`.
- Volume diferencial (ex: tumor / órgão %). Requer múltiplas medições e UI dedicada.
- Salvar medição no laudo (laudo.js só existe no `case/` antigo).

## Acceptance

- [ ] FAB abre popover com 2 opções
- [ ] Volume é calculado e exibido em cm³ ao tocar uma estrutura
- [ ] Outline cyan destaca a estrutura medida
- [ ] Pílula segue o centroide quando câmera move
- [ ] Tap em outra estrutura substitui medição sem clique extra
- [ ] `+ Nova` limpa medição mas mantém modo
- [ ] `✕ Sair` reapresenta o FAB
- [ ] Malha aberta exibe `~X,X cm³ ⚠️`
- [ ] Cubo de aresta conhecida bate matemática (±2%)
- [ ] Linear continua funcionando após refactor (suite existente verde)
- [ ] Cache evita recomputar em taps subsequentes
- [ ] Mobile (iPhone 13 / Playwright) — popover, tap, pílula, toolbar funcionam
