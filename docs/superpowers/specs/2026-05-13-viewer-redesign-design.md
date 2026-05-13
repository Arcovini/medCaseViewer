# Redesign do viewer `/case-next/` — handoff Claude Design (Medcase)

**Data:** 2026-05-13
**Repo:** `medCaseViewer`
**Sprint:** redesign — entrega 2 de 2 (a do site shipou em `9b6784b`; agora o viewer)
**Critério de aceite:** abrir `/case-next/?id=<uid>` para qualquer caso pós-Sprint-2 → carrega o novo layout `index_v3` (desktop) / `mobile_v2` (mobile): tema claro, paleta coral, hairlines clínicas, painel de camadas redesenhado, top-bar e foot-strip novos, zoom-chip e legend flutuantes. Toda a lógica de `world.js` / `dom.js` / `measurement.js` / `ar.js` continua intocada e a suite Playwright existente (`tests/case-next/*`) passa byte-a-byte sem alterações de selector. Suite Playwright nova (`tests/case-next/case-next-redesign.spec.js`) cobre a chrome adicionada.

---

## Contexto

O Sprint 3a entregou `/case-next/?id=<uid>` como scaffold Three.js. Os Sprints 3b.1 e 3b.2 adicionaram opacidade por estrutura e medição linear com lupa. O AR via `model-viewer` aterrissou logo depois (commit `9afd71a`). Tudo isso roda hoje sobre um shell dark — fundo `#272425`, tinta cyan `#00d4ff` para medição, panel-flutuante `rgb(59,57,57)`. Funcionalmente está pronto pra ser a sede do Sprint 3c (cutover), mas visualmente ainda fala o registro "software de planejamento 3D genérico" — não o editorial-clínico que o redesign do site (commit `9b6784b`) acabou de assentar.

O handoff Claude Design traz dois mockups aprovados pro viewer:

- `ui_kits/viewer/index_v3.html` — desktop, **tema claro** (canvas `#EDEFF2`, chrome `#FFFFFF`, tinta `#15171A`). 3-col grid (280px estruturas + stage + 320px metadados). Top-bar com brand+crumb+share. Foot-strip com telemetria. Chrome flutuante na stage: compass, toolset (5 ferramentas), zoom, legend.
- `ui_kits/viewer/mobile_v2.html` — mobile (artboards iPhone 13), **explora ambos os temas com toggle**. Top-strip com menu+caso+AR+Medir como pills 44px. Bottom-sheet de estruturas com hairline-rows (faixa 3px de cor + slider 2px + eye 36px). HUD de medição (toast top-center + lupa + ações bottom-center) fica sempre dark mesmo quando o canvas tá light, por legibilidade.

Tokens em `colors_and_type.css` (já no repo desde o redesign do site) cobrem todos os valores necessários (`--accent #C8412C`, `--surface-canvas #EDEFF2`, `--surface-ink-* #14181C/#0B0E11/#1F2429`, `--fg-1 #15171A`, etc.).

A migração toca `world.js` e `main.js` em escala mínima:

- **`world.js`** — flip cosmético: `COLOR_CYAN = 0x00d4ff` → `COLOR_ACCENT = 0xC8412C` (rename + valor), e `scene.background = new THREE.Color(0x272425)` → `new THREE.Color(0xEDEFF2)` (canvas claro). Sem mudança de comportamento — apenas valores de cor.
- **`main.js`** — adições pós-`bootstrap()`: handlers de top-bar (reset/fullscreen/share), zoom listener acoplado a `controls.change`, populator de legend/foot/case-head. Sem mudar o fluxo de boot.
- `dom.js`, `loader.js`, `measurement.js`, `ar.js` ficam intocados em comportamento. Os selectors e `data-testid`s que a suite Playwright existente verifica (FAB, hint, toolbar, loupe, AR button, AR modal, eye-toggle, opacity-slider, `--struct-color`) ficam idênticos.

---

## Decisões alinhadas durante o brainstorming (auto-resolvidas)

### 1. Tema: **light em ambas plataformas**

O mockup desktop é light-only; o mobile mostra um toggle dark/light. Para um v1 coeso e simples, ship light por padrão em ambas plataformas. O toggle de tema fica fora de escopo (re-introduzir depois é trivial — `colors_and_type.css` já carrega os tokens `--surface-ink-*` e `--fg-ink-*` necessários pra um modo escuro, e a CSS pode espelhar uma classe `.theme-dark` no body).

Justificativa: o registro "editorial clínico-luxo" do design system favorece o light. Dark é uma preferência ergonômica que pode voltar quando feedback clínico real pedir — não é gatekeeper da entrega.

### 2. Toolset: **drop, manter só Medir (via FAB existente) + AR**

O mockup desktop tem 5 botões na lateral direita: Girar, Medir, Anotar, Cortar, Captura. Hoje no `/case-next/`:

- Girar: comportamento default do `OrbitControls`. Não precisa de botão.
- Medir: existe (`measurement.js`), invocada pelo `.measure-fab` flutuante top-right.
- Anotar / Cortar / Captura: features que não existem. Renderizar botões para elas seria UI dishonest e contraria o registro editorial.
- AR: existe (`ar.js`), invocada pelo `.ar-button` flutuante top-right.

**Decisão:** drop a toolset visual de 5 botões inteira. As 2 interações existentes (Medir, AR) continuam sendo os botões flutuantes top-right já implementados — só são restilizados (pill 44px frosted-paper, coral active state). Quando Anotar/Cortar/Captura existirem, eles entram cada um como mais um pill no top-right, formando uma toolset orgânica.

### 3. Compass: **drop**

Mockup mostra um chip A/R/P/L bottom-left. Sem fonte de orientação anatômica (RAS vs LPS depende de DICOM, que não atravessa a pipeline ainda), um compass estático mente sobre a orientação atual da câmera. Compass dinâmico (bind à `camera.quaternion`) é viável mas adiciona ~50 linhas de Three.js + um mapeamento orientação→letras que merece um spec próprio.

Drop por agora. Re-introduzir quando o `mesh-processor` propagar metadados de orientação ou quando o input DICOM (Sprint 4+) explicitar o sistema.

### 4. Legend: **manter, mas sem métricas**

Mockup mostra um chip bottom-right com nomes de estruturas + cores + métricas ("62 cm³", "38 mm", "3 ramos"). As métricas não existem no pipeline atual — nem o `mesh-processor` calcula volume, nem o frontend extrai ramificações.

**Decisão:** renderizar a legenda com nomes + swatches de cor somente. Drop a coluna de métricas. Quando a pipeline calcular volume/distância, métricas voltam.

### 5. Right panel (case meta + notes): **hide se vazio**

Mockup mostra metadados ricos (modalidade, equipamento, estruturas, solicitante, entrega) + notas com autor/timestamp/corpo. Nada disso existe no `/case-next/` atual — o único identificador é o UID, e o GLB carrega só `[{name, color}]`.

**Decisão:** o painel direito é renderizado em desktop ≥1100px com:

- Eyebrow "Caso · ID" + UID curto (primeiros 8 chars do UID).
- Linha "Estruturas · N camadas" (derivada do GLB carregado).
- Painel de notas fica oculto via `display:none` no markup (escondido por padrão).

Quando metadados existirem (Sprint 4+ junto com autenticação/DB), o painel se expande naturalmente. Hide-se-vazio em vez de dropar mantém o grid 3-col do mockup em viewport largo.

### 6. Top-bar buttons: **Compartilhar + Tela cheia (wired) · Resetar câmera (wired) · Histórico (drop)**

Mockup tem 4 icon-buttons no top-right: Resetar câmera, Histórico, Tela cheia, Compartilhar (pill ink).

- Resetar câmera: chama `world.frameToScene()` (já existe). Wire.
- Tela cheia: API `document.body.requestFullscreen()` / `exitFullscreen()`. Wire.
- Compartilhar: `navigator.clipboard.writeText(location.href)`. Wire.
- Histórico: não há história persistida. Drop. Re-introduzir quando notas/medições persistirem (Sprint 4+).

### 7. Mobile: **adotar bottom-sheet do mockup, manter drag existente**

O `/case-next/` já tem bottom-sheet draggable (Sprint 3b commit `a6e3e1e`). O mockup mobile também usa bottom-sheet com handle, hairline-row layout, slider 2px + eye 36px. Visual converge naturalmente — restylizar o painel para casar com o mockup mantendo a lógica de drag em `dom.js` `initBottomSheet()`.

Mudanças no mobile:
- Fundo: `rgba(59,57,57,0.78)` blur → `rgba(255,255,255,0.82)` blur (paper-frosted).
- Texto: branco → tinta `#15171A`.
- Handle: cinza claro → `rgba(21,23,26,0.22)` (ink alpha).
- Rows: faixa lateral 3px (já existe via `--struct-color`) + slider 2px (hoje 6px track) + thumb 14px (hoje 24px) + eye-button 36×36 hairline (hoje 44×32 dark).
- Header "Estruturas": fonte Inter 15/600, contador de camadas em mono à direita.

### 8. Acento de medição: **coral substitui cyan**

Toda menção a `#00d4ff` (ciano cirúrgico) no `case-next/style.css` vira `var(--accent)` (`#C8412C` coral). Inclui:

- `.measurement-pill` (background)
- `.measurement-endpoint-label` (color + border)
- `.measure-fab` (color + border) — substitui o ciano por coral.
- `.measure-fab[data-state="cancel"]` (background) — fica `#ff8a7a` hoje, mas o cancelar fica mais coerente em coral hover (`var(--accent-hover) #A8341F`).
- `.measure-toolbar .btn-primary` (background)
- `.measure-loupe-crosshair` (linhas)
- `.ar-button` (color + border)

Em todos os casos a tinta de fundo continua dark (sobre canvas claro, um HUD claro lavaria) — segue o insight do mockup mobile: *HUD fica dark mesmo em theme light*.

### 9. Zoom chip: **wire to OrbitControls**

Botões − / N% / + na top-left da stage. Liga em:

- `−` (zoom out): `controls.dollyOut(1.2); controls.update();`
- `+` (zoom in): `controls.dollyIn(1.2); controls.update();`
- Percentage: distância atual da câmera ao target normalizada pela distância inicial (capturada em `frameToScene`). Calc: `(initialDistance / currentDistance * 100).toFixed(0)`.

Atualizado em cada `controls.change` event via listener leve. Funcional, não estritamente necessário, mas o mockup mostra — e adiciona valor real (input numérico de zoom é uma feature clínica).

### 10. Foot-strip: **status visual + structure count dinâmico**

Three pieces:

- Esquerda: dot verde + "Segmentação validada" (texto estático — claim sobre o pipeline `mesh-processor`).
- Centro: "Render · WebGL2 · N camadas · X MB" (N e X dinâmicos do GLB carregado).
- Direita: "v1 · Medcase / Dasa" (versão estática; pode virar `__APP_VERSION__` no futuro).

FPS é tentador mas requer hook no render loop. **Drop** pra v1 — adiciona ruído, valor clínico baixo.

---

## Arquitetura

### Arquivos novos

Nenhum arquivo JS novo. **Toda lógica existente continua intocada.**

### Arquivos modificados

- **`case-next/world.js`** — duas edições cosméticas:
  - Renomear `const COLOR_CYAN = 0x00d4ff` para `const COLOR_ACCENT = 0xC8412C` e atualizar suas 4-6 referências internas (`outlinePass.visibleEdgeColor.setHex`, `outlinePass.hiddenEdgeColor.setHex`, sphere endpoint material color, LineMaterial color, etc.).
  - `scene.background = new THREE.Color(0x272425)` → `new THREE.Color(0xEDEFF2)` para casar com o canvas claro do design.

- **`case-next/main.js`** — adições após `dom.initBottomSheet()`:
  - `populateFootStrip(structures.length, glbSizeMB)` — text de `.vw-foot-count` e `.vw-foot-size`.
  - `populateLegend(structures)` — render rows em `.vw-legend`.
  - `populateCaseHead(uid)` — text de `.vw-case-head .pid` com UID curto.
  - `wireTopBar()` — addEventListener em `[data-action="reset-camera"]`, `[data-action="fullscreen"]`, `[data-action="share"]`.
  - `wireZoom(world)` — addEventListener em `.vw-zoom button:first-child` e `:last-child`; listener em `controls.change` (precisa de uma helper `world.onControlsChange(cb)` nova exposta) que atualiza `.vw-zoom .v` text.
  - Pra evitar mudar a public API do `world.js` demais, expor `world.onControlsChange(cb)` e `world.zoomIn()` / `world.zoomOut()` / `world.getZoomPercentage()` como pequenas helpers — todas chamando funções internas no `controls`/`camera` existentes. Não mexe em estado, só lê/manipula.

- **`case-next/index.html`** — markup expandido:
  - Wrapper `.viewer` com grid 3-col em desktop.
  - Top-bar (`<header class="vw-top">`) com brand SVG + crumb + ícone-buttons + share pill.
  - Left panel (`<aside class="vw-left">`) — agora abriga o `<aside id="structures-panel">` existente em vez dele flutuar (visualmente vira o conteúdo da left panel).
  - Stage (`<main class="vw-stage">`) — abriga o `<canvas id="canvas">` existente + zoom chip + legend (HTML novo).
  - Right panel (`<aside class="vw-right">`) — case meta + notes-placeholder, `display:none` no markup quando estiver sem dados (decisão runtime no `main.js`).
  - Foot-strip (`<footer class="vw-foot">`) com 3 columns de telemetria.
  - **`<canvas id="canvas">`** continua existindo (selector preservado para `world.js`).
  - **`<aside id="structures-panel">`** continua existindo (selector preservado para `dom.js` `initBottomSheet`).
  - **`<div id="ar-root">`** continua existindo (selector preservado para `ar.js`).

- **`case-next/style.css`** — refatoração completa:
  - Body bg: `#272425` → `#FFFFFF`.
  - Body color: `#fff` → `var(--fg-1)`.
  - Importa `colors_and_type.css` do root via `<link>` no `index.html` (NÃO via `@import` em `style.css` — evita cascata indireta).
  - Mantém todas as classes existentes: `.panel`, `.panel-handle`, `.panel-title`, `.structure-row-main`, `.opacity-row`, `.structure-name`, `.eye-toggle`, `.opacity-slider`, `.overlay`, `.overlay.error`, `.measurement-pill`, `.measurement-endpoint-label`, `.measure-fab`, `.measure-hint`, `.measure-toolbar`, `.btn-primary`, `.btn-secondary`, `.measure-loupe*`, `.ar-button`, `.ar-modal*`, `.ar-root`.
  - Reestilização toda em-place — sem renomear seletores.
  - Adiciona classes novas para a chrome adicionada: `.viewer` (wrapper grid), `.vw-top`, `.vw-left`, `.vw-stage`, `.vw-right`, `.vw-foot`, `.vw-brand`, `.vw-crumb`, `.vw-share`, `.vw-icon-btn`, `.vw-zoom`, `.vw-legend`, `.vw-case-head`, `.vw-kv` (key/value), `.vw-foot-stat`, `.vw-dot-ok`. Prefixo `.vw-` evita colisão com classes existentes do `case/` ou do `site.css`.

- **`case-next/main.js`** — adições pequenas:
  - Após `loader` resolver: hook leve que popula text no `.vw-foot-stat` (estruturas count + mb), text no `.vw-case-head .pid` (UID), text na `.vw-legend` (uma row por estrutura).
  - Listener em `controls.change` que atualiza `.vw-zoom .v` (percentage).
  - Handlers para top-bar buttons: reset → `world.frameToScene()`, fullscreen → `document.body.requestFullscreen/exitFullscreen()`, share → `navigator.clipboard.writeText(location.href)`.
  - **Sem mudanças no fluxo de carregamento, no DOMContentLoaded, no init de bottom-sheet, nas funções de measurement, etc.** Tudo é adição pós-load.

### Arquivos NÃO tocados

- `case-next/world.js`, `loader.js`, `measurement.js`, `ar.js`, `dom.js` (intocados — APIs estáveis).
- `case-next/eye_icon.svg`, `eye_off_icon.svg` (mantidos; novo CSS pode usar `filter: invert(0)` em vez de `invert(1)` pra adaptar ao theme claro, mas idealmente os SVGs já viram em `currentColor` — verificar e ajustar SVGs se necessário).
- `case/`, `index.html`, `upload/`, `mesh-processor/`, `style.css` (root), `site.css`, `colors_and_type.css`.
- `tests/case-next/*` (suite existente — todos os asserts continuam válidos).
- `playwright.config.js`, `package.json`.

### Arquivos novos de teste

- **`tests/case-next/case-next-redesign.spec.js`** — suite Playwright nova, 6 cenários cobrindo as adições visuais. Detalhe abaixo.

---

## Markup section-by-section (desktop ≥1100px)

A ordem dentro de `<body>` (depois do `#ar-root` que `ar.js` consome):

### 1. `<header class="vw-top">` — 52px sticky top

- Esquerda: `<span class="vw-brand">` com SVG inline (intersecting lines on circle — copiado do mockup index_v3 linha 146-148) + "Medcase" + ponto coral + separador "/" + UID curto `caso <uid:0-8>`.
- Centro: `<span class="vw-crumb">` — texto opcional derivado dos primeiros 2-3 nomes de estruturas (e.g., "Reconstrução · <b>Artéria + tumor</b>"). Se < 2 estruturas, escondido.
- Direita: 3 icon-buttons (32×32, hairline ghost) — `data-action="reset-camera"`, `data-action="fullscreen"`, depois um `.vw-share` pill ink "Compartilhar" — `data-action="share"`. Os botões existentes `.measure-fab` (top-right body-fixed) e `.ar-button` (top-right body-fixed) **não entram no top-bar** — eles continuam flutuando sobre a stage como hoje.

### 2. `<aside class="vw-left">` — 280px, paper bg, border-right hairline

Conteúdo: o **`<aside id="structures-panel">` existente**, agora aninhado dentro do `.vw-left` (não mais position:fixed top:80px right:24px). Em viewport ≥900px, `.panel` fica em `position:static` ocupando o `vw-left` inteiro. Em <900px (mobile), volta ao bottom-sheet (fixed bottom).

Visualmente:

- `.panel` background: paper (no longer `rgb(59,57,57)`).
- `.panel-title` "Estruturas": Inter 15/600, ink `var(--fg-1)`, hairline `var(--rule)` abaixo. Adicionado um contador inline em mono à direita: "N camadas".
- `.panel li` (cada estrutura): hairline-row pattern.
  - `padding: 12px 16px`.
  - Faixa 3px lateral esquerda em `--struct-color` (já implementado via `::before`).
  - Linha 1: nome (Inter 14/500, ink) + eye-button 36×36 hairline (substitui o 44×32 dark atual).
  - Linha 2: slider 2px track (substitui 6px) + thumb 14px ink (substitui 24px branco com shadow).
- Hover: `background: var(--surface-mute)` (cinza-papel sutil).

Sem presets de câmera (mockup mostra mas não temos múltiplos presets implementados).

### 3. `<main class="vw-stage">` — center, fundo `var(--surface-canvas)` (`#EDEFF2`)

- `<canvas id="canvas">` ocupa 100% do `.vw-stage`.
- `<div class="vw-zoom">` flutuante top-left (16px da borda): 3 children inline — botão `−`, span `.v` (%), botão `+`. Tinta ink, fundo paper-frosted, hairline. Wired ao `OrbitControls`.
- `<div class="vw-legend">` flutuante bottom-right (16px da borda): título mono "Estruturas" + N rows com swatch 10×10 colorido + nome. Hairline frame, paper-frosted bg.
- Já existentes (continuam flutuando como hoje): `.measure-fab` (top-right), `.ar-button` (top-right ao lado do FAB), `.measure-hint` (top-center), `.measure-toolbar` (bottom-center), `.measure-loupe` (segue ponteiro), `.measurement-pill` (CSS2DObject), `.measurement-endpoint-label` (CSS2DObject), `.overlay` (loading), `.overlay.error`.

### 4. `<aside class="vw-right">` — 320px, paper bg, border-left hairline, **`display:none` por padrão**

- `<div class="vw-case-head">`: eyebrow "Caso", H2 "Caso <uid:0-8>", mono ID `<uid completo>`.
- `<dl class="vw-kv">`: 1 row hoje — "Estruturas" / "<N> camadas" (preenchida runtime).
- Painel de notas: `<div class="vw-notes" hidden>` — placeholder pra Sprint 4+.

Em viewport <1100px, o `.vw-right` fica oculto (CSS `display:none` em mediaquery). O `.vw-stage` ocupa o espaço.

### 5. `<footer class="vw-foot">` — 30px sticky bottom, paper bg, border-top hairline

3 children flex-justify-between:
- Esquerda: `<span class="vw-foot-stat"><span class="vw-dot-ok"></span>Segmentação <b>validada</b></span>`.
- Centro: `<span class="vw-foot-stat">Render · <b>WebGL2</b> · <span class="vw-foot-count">—</span> camadas · <span class="vw-foot-size">—</span></span>` (count e size preenchidos runtime).
- Direita: `<span class="vw-foot-stat">v1 · Medcase / Dasa</span>`.

Todos em mono 10px, tracking 0.06em, uppercase exceto valores (b children).

---

## Markup mobile (<900px)

Em viewport <900px:

- `.viewer` grid colapsa para uma coluna (`.vw-top + .vw-stage + .vw-foot`).
- `.vw-left` recebe `position:fixed bottom:0 left:0 right:0` virando o bottom-sheet — mas mantém `id="structures-panel"` aninhado dentro, e o `dom.js initBottomSheet()` continua acoplando handle ao `.panel-handle` que vive dentro de `#structures-panel`.

Wait — looking more carefully: hoje o `<aside id="structures-panel" class="panel">` JÁ é o bottom-sheet. Se aninharmos dentro de `.vw-left`, podem haver dois wrappers concorrendo pelo `position:fixed`. **Decisão simplificadora:** o `<aside id="structures-panel" class="panel">` continua sendo o elemento canônico. Em desktop, `.vw-left` é um wrapper visual que recebe `.panel` como child. Em mobile, `.vw-left` colapsa (`display:contents` ou similar) e o `.panel` retoma seu `position:fixed`. Detalhe técnico cobrir no plan.

Outra opção: deixar o `<aside id="structures-panel">` como filho direto do `<body>`, e o `.vw-left` é um wrapper vazio que serve só de slot visual em desktop (preenchido via CSS `position:absolute inset:0` do `.panel` quando dentro). Isso evita re-parenting do `.panel`. **Adotar essa abordagem** — sem mexer no JS de bottom-sheet, sem risco de regressão.

- `.vw-right`: sempre `display:none` em <1100px (já é o caso desktop).
- `.vw-foot`: pode ficar `display:none` em mobile pra economizar espaço, ou virar 1-line tipo "v1 · 4 camadas". **Decisão**: hide em mobile (foot strip é polish, e o mobile já tá apertado). `@media (max-width:768px) { .vw-foot { display:none; } }`.
- `.vw-top`: mantém. Brand fica menor (logo SVG sem o texto "Medcase" inteiro? só "M." + ponto coral? — não, mantém wordmark; só esconder o crumb).
- Zoom chip e legend: `display:none` em mobile (espaço apertado, polish-only).

---

## CSS variável e tema light

`case-next/index.html` adiciona dois `<link>` no `<head>`:

```html
<link rel="stylesheet" href="../colors_and_type.css">
<link rel="stylesheet" href="./style.css">
```

`style.css` deixa de importar Google Fonts diretamente (a importação fica em `colors_and_type.css`). Remove o `<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans...">` do `<head>` de `index.html` — Plus Jakarta Sans / Inter / JetBrains Mono já vêm via `colors_and_type.css`.

A primeira regra de `style.css` deixa de ser `html, body { background: #272425; color: #ffffff; font-family: "Nunito Sans" ... }`. Passa a ser:

```css
html, body {
  background: var(--base);
  color: var(--fg-1);
  font-family: var(--font-text);
  /* ... */
}
```

E em qualquer lugar onde tinha hex hardcoded de cores ou de tinta cyan, troca por token (`var(--accent)`) ou ink alpha (`var(--rule)`, `var(--rule-strong)`).

### Eye icons em theme light

Hoje `case-next/style.css` aplica `filter: invert(1)` no `.eye-toggle img` para que o ícone SVG branco fique visível sobre o fundo dark.

No theme light, isso lê preto sobre paper, o que é correto **se** o SVG for branco original. Mas se o SVG já é dark, `invert(1)` lê branco sobre paper — invisível.

**Verificação**: ler `case-next/eye_icon.svg` e ver qual cor de stroke usa. Se for `currentColor` ou `#fff`, ajustar a regra CSS. Detalhe no plan.

---

## Preservação de selectors e data-testids

A suite Playwright atual referencia (via `tests/case-next/case-next.spec.js` e `case-next-ar.spec.js`):

**Estruturas e olho:**
- `#structures-panel`, `#structures-list`
- `.panel`, `.panel-handle`, `.panel-title`
- `.structure-row-main`, `.opacity-row`, `.structure-name`
- `.eye-toggle[data-structure-name]`, `.eye-toggle[data-visible]`
- `.opacity-slider[data-structure-name]`
- `--struct-color` CSS var

**Measurement:**
- `.measure-fab[data-testid="measure-fab"]`, `[data-state]`
- `.measure-hint[data-testid="measure-hint"]`
- `.measure-toolbar[data-testid="measure-toolbar"]`
- `[data-testid="btn-cancel"]`, `[data-testid="btn-confirm"]`, `[data-testid="btn-clear"]`, `[data-testid="btn-new"]`
- `.measure-loupe[data-testid="measure-loupe"]`, `[data-visible]`, `[data-flip]`
- `.measure-loupe-canvas`, `.measure-loupe-label`, `.measure-loupe-crosshair`, `.measure-loupe-tail`
- `.measurement-pill`, `.measurement-endpoint-label`

**AR:**
- `.ar-button[data-testid="ar-button"]`, `[data-visible]`, `[data-loading]`
- `.ar-modal[data-testid="ar-modal"]`, `[data-visible]`
- `.ar-modal-close[data-testid="ar-modal-close"]`
- `.ar-modal-qr img`
- `#ar-root`

**Visual layout:**
- `.opacity-row` flex/block layout
- `<li>` `position: relative` (para a faixa lateral via `::before`)

**Todos esses selectors continuam existindo no novo CSS.** Os asserts (e.g., "li tem layout em coluna e position relative") ficam válidos porque o `<li>` continua sendo o container vertical com faixa colorida — o estilo muda (paper bg em vez de dark, hairline em vez de border-bottom branca alpha), mas a estrutura DOM e os layout principles seguem.

---

## Testing

### Suite existente — sem mudanças

`tests/case-next/case-next.spec.js` (~ 28 testes) e `tests/case-next/case-next-ar.spec.js` (~ 24 testes) continuam **sem alteração**. Eles validam comportamento (olho toggle, slider opacity, measurement flow, AR modal flow, etc.) — não validam cor de fundo ou tema.

Critério: `npx playwright test tests/case-next` passa byte-a-byte após o redesign. Se algum teste falhar, é regressão visual que precisamos investigar antes de merge.

### Suite nova — `tests/case-next/case-next-redesign.spec.js`

6 cenários cobrindo as adições:

1. **top-bar:** `await page.goto('/case-next/?id=test-fixture-abc123')` → `.vw-top` está visível, contém "Medcase" + UID curto, tem botões com `data-action="reset-camera"`, `data-action="fullscreen"`, `data-action="share"`.

2. **zoom chip:** zoom `.vw-zoom` está visível em desktop, mostra "100%" inicialmente; clicar em `+` mostra "120%" ou similar (>100%); clicar em `−` mostra valor entre 80-100.

3. **legend:** `.vw-legend` está visível em desktop, renderiza 4 rows (matching o fixture) com swatch colorido e nome.

4. **foot-strip:** `.vw-foot` está visível em desktop, contém "WebGL2" e "4 camadas" (matching o fixture).

5. **right panel hidden when no metadata:** `.vw-right` está `display:none` em desktop quando o caso só tem nome+cor de estrutura (que é o caso hoje). Se a meta fosse populada, o painel apareceria — mas não testamos isso aqui (futuro).

6. **mobile collapse:** em viewport <900px (mobile project), `.vw-foot` está `display:none`; `.vw-zoom` e `.vw-legend` estão `display:none`; `.vw-top` permanece visível.

Ridiculo cobertura adicional:

7. **share button copies URL:** clicar em `[data-action="share"]` chama `navigator.clipboard.writeText`. Em Playwright pode mockar `navigator.clipboard.writeText` via `page.evaluate` antes do clique e verificar o argumento. (Se complexo demais, drop e validar manual.)

---

## Flags para validar durante o review

- **UID curto** mostrado no top-bar: usamos `<uid:0..8>` ("5fc6c4d2"). Confirmar que isso lê bem clinicamente — pode ser "5fc6c4d2..." com ellipsis ou só os 4 primeiros.
- **Foot-strip claim** "Segmentação validada" — texto estático. Refletir se essa é a verdade que queremos comunicar (vs. "Segmentação por radiologistas Dasa" ou similar).
- **Versão hardcoded** "v1 · Medcase / Dasa" — manter ou injetar SHA curto no build? `mesh-processor` envia o GLB mas não tem version negotiation; pode ser hardcoded por hora.
- **Eye icons** após theme flip — verificar se ficam visíveis no paper bg após o ajuste de filter / fill.
- **AR e Measure FABs** continuam top-right da stage como pills coral. Confirmar que a sobreposição na stage não obstrui o canvas inicialmente (já é o caso hoje, só restilizam).

---

## Out of scope

- Theme toggle (dark / light) — light only por agora.
- Toolset Anotar / Cortar / Captura — features não existem.
- Compass A/R/P/L — sem patient-orientation source.
- Notes — sem backend.
- Case metadata expandido (modalidade, equipamento, solicitante, entrega) — sem DB.
- FPS counter no foot-strip — polish.
- Presets de câmera (⌘1..⌘4) — sem múltiplas views ainda.
- Histórico de medições — sem persistência.
- Migração simultânea do `/case/` legacy — fica no Sprint 3c.
- Reskin de `/upload/` — sprint futura.

---

## Ordem de migração sugerida (passa para writing-plans)

1. Adicionar `<link rel="stylesheet" href="../colors_and_type.css">` no `<head>` de `case-next/index.html`. Remover `<link>` Google Fonts (Nunito Sans/Open Sans) — fontes vêm via tokens.
2. Reescrever `case-next/index.html` com o novo wrapper `.viewer` + chrome (top, left, stage, right, foot), preservando `<canvas id="canvas">`, `<aside id="structures-panel">`, `<div id="loading">`, `<div id="error">`, `<div id="ar-root">`, `<script type="importmap">`, `<script type="module" src="./main.js">`.
3. Reescrever `case-next/style.css`:
   - Substituir o body bg + font + color iniciais por tokens.
   - Restilizar `.panel`, `.panel li`, `.opacity-slider*`, `.eye-toggle`, `.measure-*`, `.ar-*`, `.measurement-pill`, `.measurement-endpoint-label`.
   - Adicionar regras pro novo chrome (`.viewer`, `.vw-top`, `.vw-left`, `.vw-stage`, `.vw-right`, `.vw-foot`, `.vw-zoom`, `.vw-legend`, etc.).
4. Adicionar `case-next/main.js` updates: handlers de top-bar, zoom listener, legend/footer populator.
5. Validar visualmente: abrir `/case-next/?id=<fixture-uid>` no browser. Verificar que measurement, AR, opacity, eye-toggle funcionam.
6. Rodar `npx playwright test tests/case-next/case-next.spec.js tests/case-next/case-next-ar.spec.js` — deve passar tudo.
7. Adicionar `tests/case-next/case-next-redesign.spec.js`.
8. Rodar `npx playwright test` full — deve passar tudo (case-next + site + case-next-redesign).
9. Commit.
