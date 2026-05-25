# Redesign do site de marketing — handoff Claude Design (Medcase)

**Data:** 2026-05-12
**Repo:** `medCaseViewer`
**Sprint:** redesign (paralelo a 3b/3c) — entrega 1 de 2 (esta é a do site; depois vem o viewer)
**Critério de aceite:** abrir `https://biodesignlab.com.br/` (e local em VS Code Live Server) → carrega o novo layout `index_v2`-equivalente, sem Tailwind, com tokens do design system, mantendo GTM/DoubleClick/pixel WhatsApp/JSON-LD/canonical funcionais; suite Playwright nova em `tests/site/` passa em desktop e mobile.

---

## Contexto

O handoff em `~/Downloads/Biodesignlab Design System-handoff.zip` é o bundle exportado de Claude Design contendo:

- `colors_and_type.css` — tokens canônicos como custom properties (cores, tipo, espaçamento, raios, motion).
- `ui_kits/site/index_v2.html` — mockup aprovado da landing.
- `ui_kits/viewer/index_v3.html` e `mobile_v2.html` — mockups aprovados do viewer (escopo da **próxima** spec).
- `HANDOFF.md` — instruções de migração (drop Tailwind, mapeamento de tokens, ordem sugerida).

A produção atual em `/index.html` usa **Tailwind via CDN** + Nunito Sans/Open Sans + paleta azul-cobalto (`#0C245C`) e laranja-bootstrap (`#E95D4A`) para CTAs. O redesign troca:

- **Fundamento:** Tailwind CDN → CSS puro + `colors_and_type.css` (tokens).
- **Tipo:** Nunito Sans/Open Sans → Plus Jakarta Sans (display, peso 300–500) + Inter (texto) + JetBrains Mono (eyebrows, telemetria, telefones).
- **Paleta:** azul/laranja → branco puro `#FFFFFF` (base) + coral contido `#C8412C` (único acento, reservado a CTAs primárias e momentos críticos) + cinzas-papel `#F2F3F5`/`#E6E8EC` para bandas.
- **Registro:** "saúde corporativa azul" → editorial clínico-luxo (fairlines em vez de cards, sem gradientes, sem sombras decorativas, sem emoji).
- **Wordmark:** "Biodesignlab" → **Medcase** em todo o user-facing (incluindo `<title>`, OG/Twitter, JSON-LD Organization.name). Domínio `biodesignlab.com.br` **não muda**.

A migração não toca `/case/` (Sketchfab legado), `/case-next/` (Three.js — próxima spec), `/upload/` (Tailwind, deixada como está) nem o `style.css` grande (vendor + ferramentas do `/case/`).

---

## Decisões alinhadas durante o brainstorming

### 1. Marca: Medcase em todo o user-facing

**Decisão:** flipar "Biodesignlab" → "Medcase" em:

- `<title>` → `Medcase | Visualizador cirúrgico 3D`
- `og:title`, `twitter:title` → `Medcase – Visualizador cirúrgico 3D`
- JSON-LD `Organization.name` → `Medcase` (mantém `@id`, `url`, `telephone`, `sameAs`, `logo`).
- JSON-LD `VideoObject.name` → `Visualizador 3D cirúrgico Medcase – demonstração`.
- Wordmark visível no header e no footer.
- Linha de copyright no footer: `© 2026 MEDCASE · PUC-RIO · DASA`.

**Não muda:** domínio (`biodesignlab.com.br`), o `Organization.@id` (URI estável é critério de Schema.org), o `Organization.url`, o `Organization.logo` (apontando para `/images/og-logo.jpg` — asset não recriado), `Organization.sameAs` (redes da Alta Diagnósticos — esse perfil de SEO segue sendo o "owner" do domínio para Google).

**Por quê:** o usuário decidiu pela marca Medcase em vez de Biodesignlab para o produto. O domínio segue por razões de SEO/equity histórico e porque a marca corporativa por trás é a mesma. A inconsistência aparente entre wordmark "Medcase" e domínio `biodesignlab.com.br` é tolerada nesta fase — uma migração de domínio sairia de escopo.

### 2. Conteúdo: copy do mockup é canônico

**Decisão:** adotar a copy editorial do `ui_kits/site/index_v2.html` integralmente. O texto da produção atual é **descartado** onde diverge, incluindo:

- Headline "Visualizador 3D cirúrgico" → **"Anatomia como evidência."** (com sublinhado coral à mão na palavra "evidência").
- Subhead "Soluções para planejamento de cirurgias complexas no seu computador ou dispositivo móvel..." → **"Reconstruções 3D de alta fidelidade entregues em até cinco dias. Visualização interativa para cirurgia complexa — no consultório, na sala, no celular do plantonista."**
- Prazo de entrega: **5 dias** em todos os lugares (mockup original do redesign falava 3 dias; atualizado em 2026-05-25 para refletir o prazo real de produção).
- Headline "Passo a passo" → **"Do exame ao bisturi."**
- Headline "Avaliação pré-operatória" → **"Gire, meça, compartilhe."**
- Headline "Médicos responsáveis" → **"Quem assina cada caso."**
- Headline "Potencialize sua estratégia cirúrgica" → **"Cada caso vira um plano cirúrgico."**

**Conteúdo da produção atual que é descartado:**

- Lista de especialidades cobertas (músculo-esquelético, pulmão, rim, fígado, pâncreas, bariátrica) — sai. O novo product moment lista capacidades do visualizador (estruturas independentes, ferramentas de medida, compartilhamento direto), não especialidades.
- Colunas sociais do footer (Alta Diagnósticos, CDPI, Bronstein, com Instagram/Facebook/LinkedIn) — saem. O novo footer tem 4 colunas editoriais: wordmark+tagline, Produto, Equipe, Concierge.
- Copyright "© 2025 Alta Diagnósticos, CDPI & Bronstein" — sai. Substituído por "© 2026 MEDCASE · PUC-RIO · DASA".
- Endereço físico CDPI Barra (Av. das Américas, 4666...) — sai. Footer fica editorial; endereço pode voltar em página separada de contato se necessário (fora do escopo).

**Por quê:** copy do mockup faz parte do redesign — o tom editorial-clínico ("anatomia como evidência", "do exame ao bisturi") é parte do redesign visual, e separá-los reintroduziria a inconsistência entre formato e mensagem. Cada headline foi escolhida em Claude Design para encaixar com a respectiva ilustração/grid; misturar com a copy antiga quebraria o ritmo editorial.

### 3. Claims na CTA card: ship as-is

Os 4 tick-rows da CTA escura ficam exatamente como no mockup:

- 01 · Sem instalação · Abre no navegador, no celular do plantão.
- 02 · Sem login obrigatório · Link direto, válido por 30 dias.
- 03 · Compatibilidade total · iOS, Android, desktop. Sem app.
- 04 · Validado pela radiologia Dasa · Cada modelo revisado pelo time clínico.

**Nota factual:** o claim "Link direto, válido por 30 dias" não corresponde ao comportamento técnico atual (UIDs em R2 não expiram, e o `/case-next/` carrega qualquer GLB sem checagem de prazo). O usuário aprovou ship as-is durante o brainstorming, ciente da divergência — pode ser uma promessa de produto a implementar depois (eg. Sprint 4+ junto da autenticação), ou pode ser retorquido para "Acesso permanente" se o produto não fizer expirar. **Esta spec não implementa expiração de links; só ship a copy.**

### 4. Alvo do viewer: **`/case-next/`** (próxima spec)

O HANDOFF.md original instruía a aplicar o chrome novo sobre `/case/` (iframe Sketchfab) como medida interina. O usuário escolheu `/case-next/` (Three.js) como alvo único — o trabalho do viewer entra em uma **spec separada**, posterior a essa do site. Este documento não toca o viewer.

### 5. Página `/upload/`: deixada como está

Continua em Tailwind CDN com Nunito Sans/Open Sans. Pode receber reskin em uma spec futura quando os tokens estiverem provados em duas superfícies (site + viewer). Não é a primeira impressão para clínicos novos (que chegam pelo `/case/?id=...`), então o custo de adiar é baixo.

---

## Arquitetura

### Arquivos novos (raiz do repo)

- **`/colors_and_type.css`** — cópia byte-a-byte de `~/Downloads/Biodesignlab Design System-handoff.zip → biodesignlab-design-system/project/colors_and_type.css`. Importa Google Fonts (Plus Jakarta Sans, Inter, JetBrains Mono) via `@import` no topo. Define `:root` com todos os tokens, mais regras semânticas para `html`/`body`/`h1..h4`/`p`/`.eyebrow`/`code`/`a`/`hr`/`::selection`.

- **`/site.css`** — estilos específicos da landing, extraídos do bloco `<style>` inline de `ui_kits/site/index_v2.html` (linhas 5–206). O bloco local `:root { --pp-* }` (linhas 11–22) é **deletado**; todas as referências `var(--pp-…)` são reescritas para os tokens canônicos conforme tabela em §2 do HANDOFF.md (também repetida aqui em "Token reconciliation" abaixo). Arquivo dividido em seções com banners de comentário (`/* Marketing — HEADER */`, `/* Marketing — HERO */`, etc.).

### Arquivo modificado

- **`/index.html`** — reescrito quase inteiro. Mantém o `<head>` com GTM, DoubleClick, pixel de homepage, JSON-LD, canonical, OG, Twitter (com `name`/`description` flipados para Medcase). Substitui o `<script src="https://cdn.tailwindcss.com">` por dois `<link rel="stylesheet">` para `colors_and_type.css` e `site.css`. Substitui o `<body>` inteiro pelo markup do mockup com classes semânticas (`.hdr`, `.wrap`, `.hero`, `.trust`, etc.). Mantém o GTM noscript no topo do `<body>` e o script de rastreio de cliques WhatsApp no final.

### Arquivos NÃO tocados

- `/style.css` (~11.7k linhas, vendor + ferramentas do `/case/` legado). Continua linkado em `/case/index.html` apenas.
- `/case/index.html` e tudo em `/case/*` (Sketchfab legado).
- `/case-next/*` (Three.js — alvo da próxima spec).
- `/upload/*` (Tailwind, fora de escopo).
- `/images/*` (todos os assets já existem; nenhum precisa ser adicionado).
- `/videoViewer.mp4` (já na raiz, é o vídeo da hero).
- `/tests/case-next/*` (suite existente do viewer).
- `playwright.config.js` (já configurado com webServer http-server).
- `/package.json` (sem novas deps; o site é estático).

### Arquivos novos de teste

- **`/tests/site/site.spec.js`** — suite Playwright nova, 6 cenários (detalhe em "Testing" abaixo).

---

## Markup section-by-section

A ordem dentro de `<body>` é (top to bottom, depois do GTM noscript):

### 1. `<header class="hdr">` — sticky, paper bg w/ blur

- `.wrap.hdr-row` flex space-between.
- **Esquerda:** `<a class="brand-lockup">` com texto-only:
  - `<span class="lockup-brand">Medcase</span>` (Plus Jakarta 600, 16px, tracking -0.02em).
  - `<span class="lockup-product">Visualizador cirúrgico</span>` (Mono 10px, +0.10em, uppercase, cor `--fg-3`).
  - **Sem `<img>`**: o mockup carrega `biodesignlogo-square.jpg` com `width:0px` (invisível); replicamos o resultado removendo o `<img>` em vez de manter um asset oculto.
- **Direita:** `<nav class="nav">`
  - 3 links de seção: `<a href="#produto">Produto</a>`, `<a href="#numeros">Números</a>`, `<a href="#equipe">Equipe</a>`. Visíveis ≥900px.
  - `<a class="hdr-tel" href="tel:+5521993118288">` com ícone SVG de telefone + texto mono `(21) 99311-8288`. Visível ≥1100px (oculto abaixo).
  - `<a class="btn-primary coral" href="https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias." target="_blank" rel="noopener">Solicitar →</a>`.

### 2. `<section class="hero">` — asymmetric 1.05/1 grid

- **Coluna esquerda:**
  - Eyebrow mono: `Planejamento pré-operatório · 2026`.
  - H1 `<h1 class="headline">Anatomia<br>como <span class="scribble">evidência<svg…/></span>.</h1>` (o SVG é um path coral hand-drawn sobre a palavra "evidência").
  - Lede 18px: "Reconstruções 3D de alta fidelidade entregues em até cinco dias. Visualização interativa para cirurgia complexa — no consultório, na sala, no celular do plantonista."
  - `.cta-row` com:
    - Coral `<a class="btn-primary coral">Solicitar um caso →</a>` → WhatsApp deeplink.
    - Ghost `<a class="btn-ghost">▸ Abrir caso demo</a>` → `https://biodesignlab.com.br/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4`.
  - Linha "ou ligue para a concierge — `(21) 99311-8288`" com link `tel:`.

- **Coluna direita:** `.hero-vis`
  - `.hero-vis-pad` (fundo `--surface-mute-2`, raio 24px, padding 28px).
  - Dentro: `.hero-canvas` (raio 14px, sombra dupla) com `<video autoplay muted loop playsinline src="/videoViewer.mp4">` e dois chips `<span class="tag">`: "Caso 7d3a · Artéria renal" (top-left) e "3D · Interativo" (top-right).
  - Dois chips flutuantes **fora** do pad: `.chip-1` (top, "AngioTC · 0,6mm" com dot coral) e `.chip-2` (bottom-left, "Entrega · 5 dias" com numeral display).

### 3. `<section class="trust">` — paper bg, hairline top+bottom

- `.trust-head` 2-col: eyebrow "Em uso na rede" + display headline "Operando ao lado das principais redes do Rio." à esquerda; sub-paragraph "Disponibilizado nas unidades Dasa — Alta Diagnósticos, CDPI e Bronstein — e nos hospitais da rede Américas." à direita.
- `.partners` grid 4-col com hairline `border-right` entre células:
  - `/images/LogoDasa 1.png` (alt "Dasa").
  - `/images/Alta-logo-1.webp` (alt "Alta Diagnósticos").
  - `/images/logoCDPI.png` (alt "CDPI").
  - `/images/bronsteinLogo.jpg` (alt "Bronstein").
- Em <900px: collapse para 2×2 com bordas reorientadas.

### 4. `<section class="section cream" id="produto">` — Como funciona, banda cinza-papel

- `.how-head` 2-col: eyebrow "Como funciona" + display "Do exame ao bisturi." à esquerda; lede à direita.
- `.how-grid` 3-col com 3 `<article class="step">`:
  - **01 · Solicitação** — SVG inline (formulário + ícone + coral). Headline "Solicitação na unidade". Body: "O cirurgião pede angiotomografia ou ressonância com pós-processamento 3D em qualquer unidade da rede."
  - **02 · Segmentação** — SVG inline (3 placas empilhadas com kidney+vessel+tumor coral). Headline "Segmentação e malha 3D". Body: "Nossa equipe segmenta as estruturas relevantes. Cada órgão, vaso e lesão vira uma camada nomeada e ajustável."
  - **03 · Entrega** — SVG inline (smartphone com check mint). Headline "Link interativo em 5 dias". Body: "Abre direto no navegador. Sem instalação, sem login. Funciona no celular durante o plantão, em qualquer dispositivo."

### 5. `<section class="section soft">` — Product moment, paper bg

- `.product` 1/1.4 grid:
  - **Esquerda:** eyebrow "No visualizador" + headline "Gire, meça, *compartilhe.*" (palavra "compartilhe" em coral, italic-styled-as-roman). Lede curta. `<ul class="feat-list">` com 3 itens hairline-divided:
    - Ícone barras + h4 "Estruturas independentes" + body.
    - Ícone seta+círculos + h4 "Ferramentas de medida" + body.
    - Ícone upload + h4 "Compartilhamento direto" + body.
  - **Direita:** `.product-shot.devices` com `<img src="/images/mockups.png">` (PNG transparente multi-device — sem fundo, sem sombra, sem padding extra).

### 6. `<section class="section soft" id="equipe">` — Médicos responsáveis, paper bg

- `.how-head` 2-col: eyebrow "Médicos responsáveis" + display "Quem assina cada caso." à esquerda; lede à direita.
- `.doctors` 2-col com 2 `<article class="doc">`:
  - **Vitor Sardemberg** — `<img src="/images/vitor_photo.jpg">` (round 120×120, cropped via `object-fit:cover`), eyebrow "Radiologista", display name, "CDPI · Alta Diagnósticos", `<a class="doc-tel" href="tel:+5521982204508">` `(21) 98220-4508` com ícone phone.
  - **Romulo Varella** — `<img src="/images/rvarella.jpg">`, "Hospitais São Lucas · CHN", `tel:+5521999465979` → `(21) 99946-5979`.

### 7. `<section class="section" id="numeros">` — CTA card escura

- `.cta-card` ink bg `#1A1815` (mapped to `--fg-1` por aproximação warm→cool), raio 28px, padding generoso, decoração radial coral top-right via `::before`.
- 1.2/1 grid:
  - **Esquerda:** eyebrow "Próximo caso" (cor branca 70% opacidade), H2 "Cada caso vira um plano cirúrgico.", lede "Envie o exame na unidade Dasa. Em até cinco dias úteis o link do modelo 3D chega no seu celular, pronto para girar, medir e compartilhar com a equipe." Botão coral "Solicitar um caso →" + botão ghost-on-dark "▸ Abrir caso demo".
  - **Direita:** 4 tick-rows com keys mono coral e labels brancos:
    - `01` Sem instalação · Abre no navegador, no celular do plantão.
    - `02` Sem login obrigatório · Link direto, válido por 30 dias.
    - `03` Compatibilidade total · iOS, Android, desktop. Sem app.
    - `04` Validado pela radiologia Dasa · Cada modelo revisado pelo time clínico.

### 8. `<footer class="ftr">` — dark, ink bg

- `.ftr-grid` 1.4/1/1/1 grid:
  - **Col 1:** Wordmark `Medcase.` (com período coral) + tagline "Visualizador 3D cirúrgico."
  - **Col 2 (Produto):** Visualizador, Upload de caso, Documentação.
  - **Col 3 (Equipe):** Médicos responsáveis, Pesquisa, Publicações.
  - **Col 4 (Concierge):** `<a href="tel:+5521993118288">+55 21 99311-8288</a>`, WhatsApp deeplink, `<a href="mailto:contato@biodesignlab.com.br">`.
- `.ftr-foot`: mono strip "© 2026 MEDCASE · PUC-RIO · DASA" à esquerda, "RIO DE JANEIRO · BR" à direita.

---

## Preservação byte-a-byte (não regredir)

Os blocos abaixo do `<head>` atual e do final do `<body>` ficam **exatamente como estão**, com a única exceção do flip de marca em `name`/`description` (campos JSON-LD/OG/Twitter):

### Preservado no `<head>` (sem mudar nenhum byte além de marca)

1. **Google Tag Manager loader** (linhas 6–13 atuais):
   ```html
   <script>(function (w, d, s, l, i) { ... })(window, document, 'script', 'dataLayer', 'GTM-NX75SZPR');</script>
   ```
2. **DoubleClick gtag init** (linhas 16–22):
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id=DC-10089018"></script>
   <script>
     window.dataLayer = window.dataLayer || [];
     function gtag() { dataLayer.push(arguments); }
     gtag('js', new Date());
     gtag('config', 'DC-10089018');
   </script>
   ```
3. **Pixel de homepage on load** (linhas 25–33) — dispara `'send_to': 'DC-10089018/invmedia/br_da000+standard'`.
4. **Canonical** `<link rel="canonical" href="https://biodesignlab.com.br/">`.
5. **JSON-LD `@graph`** — apenas `Organization.name` flipa para "Medcase" e `VideoObject.name` recebe " Medcase" no sufixo. Outros campos (`@id`, `url`, `telephone`, `sameAs`, `logo`, `contentUrl`, `embedUrl`, `thumbnailUrl`) ficam idênticos.

### Preservado no `<body>` (sem mudar nenhum byte)

6. **GTM noscript iframe** (linhas 111–113) — primeiro elemento do `<body>`.
7. **Script de rastreio de cliques WhatsApp** (linhas 455–479, no final do `<body>`) — listener delegado em `document` que detecta clique em `<button>` ou `<a>` cujo `href` ou `onclick` contém `wa.me`, dispara `gtag('event', 'conversion', { 'send_to': 'DC-10089018/invmedia/br_da001+standard' })`. **Sobrevive ao redesign porque todos os novos CTAs Solicitar usam href `https://wa.me/...`** (não `onclick`).

### Flipado para Medcase

- `<title>` → `Medcase | Visualizador cirúrgico 3D`.
- `<meta name="description">` → `Reconstruções 3D de alta fidelidade para planejamento cirúrgico. Receba o visualizador interativo em até 5 dias úteis.`
- `<meta property="og:title">` e `<meta name="twitter:title">` → `Medcase – Visualizador cirúrgico 3D`.
- `<meta property="og:description">` e `<meta name="twitter:description">` → mesma description.
- JSON-LD `Organization.name` → `Medcase`.
- JSON-LD `VideoObject.name` → `Visualizador 3D cirúrgico Medcase – demonstração`.
- JSON-LD `VideoObject.description` (opcional) → "Demonstração rápida do visualizador 3D interativo da Medcase para cirurgias complexas."

**Não mudam:**
- `og:url` (`https://biodesignlab.com.br/`).
- `Organization.@id` (`https://biodesignlab.com.br/#org` — URI estável conforme Schema.org).
- `Organization.url`, `Organization.logo`, `Organization.telephone`, `Organization.sameAs`.
- `VideoObject.@id`, `VideoObject.thumbnailUrl`, `VideoObject.uploadDate` (fica `2025-05-20`), `VideoObject.duration`, `VideoObject.contentUrl`, `VideoObject.embedUrl`.

---

## Token reconciliation

Conforme HANDOFF §3, deletar o bloco local `:root { --pp-* }` do mockup e mapear as referências:

| Mockup `--pp-*` (deletar) | Canonical em `colors_and_type.css` |
|---|---|
| `--pp-cream` `#F2F3F5` | `var(--surface-mute)` |
| `--pp-cream-2` `#E6E8EC` | `var(--surface-mute-2)` |
| `--pp-paper` `#FFFFFF` | `var(--paper)` |
| `--pp-ink` `#1A1815` | `var(--fg-1)` (`#15171A` — diferença warm→cool ≤ 5 unidades por canal, aceitável) |
| `--pp-rule` `rgba(26,24,21,0.08)` | `var(--rule)` `rgba(21,23,26,0.08)` |
| `--pp-coral` `#E8745A` | `var(--illus-coral-bright)` — usado apenas dentro do SVG da etapa 01 ("Solicitação") |
| `--pp-coral-soft` `#F4C8B8` | inline literal no SVG (uso único) |
| `--pp-mint` `#CFDCD2` | `var(--illus-mint)` — usado no SVG da etapa 03 |
| `--pp-sky` `#BFD0D9` | `var(--illus-sky)` — usado no SVG da etapa 02 |
| `--pp-butter` `#EBD9A8` | `var(--illus-butter)` — não usado nos SVGs atuais, mas mantém token disponível |
| `--accent` (referenciada via `colors_and_type.css`) | `var(--accent)` `#C8412C` — coral primária, CTAs |

Coral aparece **apenas** em:
- Botão `.btn-primary.coral` (Solicitar) — header, hero, CTA card.
- Headline `.headline em` em "Anatomia como **evidência**" (a palavra "evidência").
- Headline `.h2 em` em "Gire, meça, **compartilhe.**" e em "**evidência**" do trust title.
- `.scribble svg` (sublinhado hand-drawn coral).
- `.chip .dot` (bolinha coral nos chips flutuantes do hero).
- `.tick-row .k` (mono key dos tick-rows da CTA card).
- `.cta-card::before` (decoração radial top-right da CTA card).

**Em nenhum outro lugar.** Se um elemento parece "precisar" de mais um acento, ele vira **ink** (`--fg-1`) ou **rule** (`--rule`) em vez de um segundo coral.

---

## Tipo, espaçamento, responsividade

### Type stack

- **Display (`--font-display`):** `"Plus Jakarta Sans"`, pesos 300/400/500/600/700. Sentence case, tracking negativo. Usado em `.headline`, `.h2`, `.trust-title`, `.doc-name`, `.stat-n`, `.cta-card h2`, `.kol .q`, `.step h3`, `.feat-list h4`, `.lockup-brand`, `.case-head h2`.
- **Text (`--font-text`):** `"Inter"`, pesos 400/500/600/700. Body, UI, lede, navegação.
- **Mono (`--font-mono`):** `"JetBrains Mono"`, pesos 400/500/600. Eyebrows, telemetria, telefones, copyright, números display, keys de tick-row.

Todos importados via `@import url(...)` em `colors_and_type.css`. Nenhum `<link>` adicional no `<head>`.

### Espaçamento

- `--space-7` (48px) padding lateral do `.wrap` em ≥900px.
- `--space-5` (24px) padding lateral em <900px.
- `--space-9` (96px) entre seções marketing (`.trust` top/bottom, `.section` top/bottom).
- `--space-10` (128px) `.section.cream` e `.section.soft`.

### Breakpoints

- **`--bp-md` 1100px** — esconde `.hdr-tel` (concierge phone pill).
- **`--bp-md` 900px** (custom inline `@media(max-width:900px)`) — collapse de:
  - `.hero-grid` → 1 col.
  - `.trust-head` → 1 col.
  - `.partners` → 2 cols × 2 rows.
  - `.how-head`, `.how-grid` → 1 col.
  - `.product` → 1 col (na verdade dispara em 1100px, custom).
  - `.kol-grid`, `.doctors` → 1 col.
  - `.stats` → 2 cols.
  - `.ftr-grid` → 2 cols.
- **`--bp-md` 560px** — `.doc-photo`/`.doc img` encolhe de 120×120 → 88×88 e padding cai.
- **`--bp-md` 1000px** — `.cta-card` collapse para 1 col.

### Hover / active (HANDOFF §"visual foundations")

- **Color shift only.** Sem `transform: scale()`, sem bounces.
- `.btn-primary.coral:hover` → bg `--accent-hover` (`#A8341F`).
- `.btn-ghost:hover` → bg ink, color paper.
- `.hdr-tel:hover` → `border-color: var(--fg-1)`.
- `.doc-tel:hover` → `border-color: var(--fg-1)`, `color: var(--accent)`.
- Links genéricos `a:hover` → `color: var(--accent)` (definido em `colors_and_type.css`).

### Motion

- Default duration `--dur-micro` (180ms) em `--ease-standard`. Aplicado em transitions de bg/color/border.
- Sem scroll-driven animations nesta primeira spec — `IntersectionObserver` fica para uma iteração de polish posterior se desejado. O hero vídeo já tem motion intrínseco.
- `prefers-reduced-motion` — o `<video>` tem `autoplay`; respeita preferência implicitamente porque `muted` (não há som), mas para conformidade vamos adicionar `media="(prefers-reduced-motion: no-preference)"` no atributo `autoplay` via JS curto inline, ou alternativamente um `@media (prefers-reduced-motion: reduce) { video { animation-play-state: paused; } }` que não funciona para `<video>`. **Decisão:** adicionar um pequeno script no fim do `<body>`:
  ```html
  <script>
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('video[autoplay]').forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
    }
  </script>
  ```
  Inserido **antes** do script de WhatsApp tracking para não interferir.

---

## Testing

Suite Playwright nova em **`/tests/site/site.spec.js`**, seguindo a convenção de `/tests/case-next/case-next.spec.js`. O `playwright.config.js` já tem `webServer` configurado para `http-server` na raiz, então o suite acessa `http://localhost:5500/` (ou porta default do http-server) sem mudanças de config.

6 cenários:

1. **smoke** — `goto('/')` carrega; `await expect(page).toHaveTitle(/Medcase/i)`; `await expect(page.locator('.lockup-brand')).toContainText('Medcase')`; `await expect(page.locator('h1.headline')).toContainText('Anatomia')`.

2. **cta wiring** — todos `.btn-primary.coral` têm `href` que começa com `https://wa.me/5521993118288`; todos `.btn-ghost` (links que abrem demo) têm `href` que começa com `https://biodesignlab.com.br/case-next/?id=`; assertions dentro de hero e CTA card.

3. **partner row** — 4 `<img>` em `.partners .cell` carregam (`naturalWidth > 0` via `page.evaluate`); cada um tem `alt` não-vazio (acessibilidade).

4. **hero video** — `page.locator('.hero-canvas video')` está visível, tem atributos `autoplay`, `muted`, `loop`, `playsinline`; `src` termina em `videoViewer.mp4`.

5. **GTM e pixel** — após carregar, `await page.evaluate(() => window.dataLayer)` retorna array contendo objeto com `event: 'gtm.js'`. Clicar no primeiro `.btn-primary.coral` (Solicitar do header) e verificar via `page.on('console')` ou via `page.evaluate(() => window.dataLayer)` que um novo objeto `{ event: 'conversion', send_to: '...br_da001...' }` foi pusheado. **Nota:** WhatsApp deeplink abre nova aba; precisamos interceptar `page.on('popup')` ou usar `page.evaluate` para clicar sem navegação. Detalhe vai no plan.

6. **anchor navigation** — clicar em nav `Produto` rola para `#produto` (verifica que o elemento `.section.cream` está visible no viewport). Idem para `Números` e `Equipe`.

A suite roda em ambos os projects de Playwright (desktop chromium + mobile iPhone 13) conforme `playwright.config.js` existente. Mobile cobre a versão collapsed (nav escondida, concierge pill escondida).

---

## Flags para validar durante o review da spec

Não bloqueiam o draft; o usuário pode editar no review:

- **Demo case UID** `5fc6c4d2d77d4ab6a8cadfe8996c70a4` — confirmar que existe em R2 e renderiza no `/case-next/`. Se não existir, trocar para um UID real (ou abrir um caso de demonstração estável).
- **JSON-LD `uploadDate`** `2025-05-20` — manter ou refrescar.
- **PUC-Rio · Dasa** no copyright do footer — confirmar afiliação institucional para print.
- **"Link válido por 30 dias"** na CTA card — confirmado durante brainstorm (ship as-is), mas registrado aqui como dívida com o produto.
- **Email `contato@biodesignlab.com.br`** no footer — confirmar que existe e roteia.
- **Hostinger deploy path** — confirmar que o site é servido a partir da raiz do repo (espelha o estado atual; `colors_and_type.css` e `site.css` devem ir como arquivos top-level).

---

## Out of scope (próximas specs / sprints)

- `/case-next/` viewer redesign — próxima spec, mesmo handoff.
- `/upload/` Tailwind→tokens — depois que viewer shipar.
- `/case/` Sketchfab legado — fica sem reskin até Sprint 3c.
- Custom wordmark / logo asset Medcase — text-only wordmark é suficiente.
- Migração de domínio para `medcase.com.br` ou similar.
- Versão em inglês — pt-BR é o registro home; English depois do redesign assentar.
- Implementar expiração de links (claim "30 dias" na CTA card) — feature de produto futura.
- CI/CD — Playwright continua local; sem GitHub Actions nesta spec.
- Scroll-driven animations (IntersectionObserver) — polish posterior.

---

## Ordem de migração sugerida (passa para writing-plans)

1. Adicionar `/colors_and_type.css` (cópia do handoff).
2. Adicionar `/site.css` com os estilos do mockup + token replacements.
3. Reescrever `/index.html`:
   - Head: flip marca + remove Tailwind script + add `<link>` para tokens e site.css.
   - Body: substitui todo o conteúdo dentro de `<div class="container mx-auto ...">` pelas novas seções.
   - Mantém GTM noscript no topo e WhatsApp tracking script no fim.
4. Adicionar `/tests/site/site.spec.js` com os 6 cenários.
5. Rodar `npx playwright test tests/site` em desktop e mobile; corrigir até verde.
6. Verificar manual em VS Code Live Server (port 5500): hero renderiza, vídeo toca, CTAs abrem WhatsApp/case-next, nav scroll funciona, fonts Plus Jakarta/Inter/Mono carregam, sem console errors.
7. Commit em um único PR (escopo único de migração de marketing).

A meta é um único PR que troca o site inteiro para o novo registro; não há valor em landear "header novo + hero antigo" como passo intermediário, porque o registro editorial não bate com o registro azul-cobalto do resto da página. O risco de PR grande é mitigado pela suite Playwright (catch regressões de CTA/pixel) e pela ausência de mudanças no `/case/`, `/case-next/`, `/upload/`, ou no `mesh-processor`.
