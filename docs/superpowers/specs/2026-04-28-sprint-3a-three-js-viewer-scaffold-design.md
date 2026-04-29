# Sprint 3a — Three.js viewer scaffold (parity-minimum)

**Data:** 2026-04-28
**Repo:** `medCaseViewer`
**Sprint:** 3a (parte 1 de 3 da migração do viewer Sketchfab → Three.js)
**Critério de aceite:** abrir `/case-next/?id=<uid>` para qualquer caso uploadado pós-Sprint-2 → modelo renderiza no canvas, painel de estruturas mostra um item por mesh nomeado, toggle por estrutura funciona, testes Playwright passam.

---

## Contexto

Hoje `https://biodesignlab.com.br/case/?id=<uid>` carrega um iframe do Sketchfab. O Sprint 2 já passou a escrever cada GLB também no Cloudflare R2 (`cases/{uid}.glb`), em paralelo com o Sketchfab. O Sprint 3a constrói uma viewer Three.js nativa em `/case-next/` que lê do R2, **sem tocar em `/case/` ainda**. O `/case/` continua no iframe Sketchfab — clínicos não veem nenhuma mudança até o cutover do Sprint 3c.

Este spec cobre **apenas** o 3a: scaffold mínimo que prova que o GLB renderiza com a aparência certa, os toggles de estrutura funcionam, e existe rede de testes para detectar regressões. **Não inclui** medição, anotações, opacidade, laudo (Sprint 3b).

---

## Decisões alinhadas durante o brainstorming

### 1. Acesso ao R2 a partir do navegador

**Decisão:** habilitar **Public Access** no bucket `clinical-3d` via painel Cloudflare. URL passa a ser `https://pub-<hash>.r2.dev/cases/{uid}.glb`.

**Trade-off aceito:** qualquer pessoa com o UID consegue baixar o GLB. Mesmo nível de acesso de hoje (Sketchfab com `isDownloadable=true` já funciona assim, e os GLBs não contêm PHI). A URL `pub-<hash>.r2.dev` é "feia" mas adequada para 3a; migração para custom domain (`cdn.biodesignlab.com.br`) fica para 3b/3c.

### 2. Visual do `/case-next/`

**Decisão (revisada 2026-04-28 durante a fase de planejamento):** parity visual **shell** com o `/case/` atual. O painel lateral, ícones de toggle (eye / eye-off), tipografia (Nunito Sans + Open Sans via Google Fonts) e tons de fundo (`#272425` para o body, `rgb(59, 57, 57)` para o painel) são reproduzidos manualmente no `style.css` local — **sem** reaproveitar o `style.css` legado de 197 KB (Bootstrap antigo).

**Elementos que ficam fora do 3a** (por serem features ainda não implementadas, não por divergência visual): slider de opacidade por estrutura, botão "Medir", toggle de tema (lua/sol). Quando essas features chegarem no 3b, os elementos visuais correspondentes aparecerão naturalmente.

**Por que parity visual sem parity de feature:** evitar que o `/case-next/` pareça uma versão "rascunho" durante o desenvolvimento — o usuário compara visualmente com o `/case/` real e confiança no progresso depende de proximidade visual desde o início. A divergência aceita é por feature ausente, não por estilo provisório.

### 3. Arquitetura de código (variante leve de Clean Architecture)

**Decisão:** separação por **camada** — mundo 3D vs DOM vs rede. Sem cerimônia de domain/use cases/adapters explícitos por enquanto; quando o domínio crescer (auth, metadados clínicos), entidades e use cases entram naturalmente.

```
medCaseViewer/case-next/
├── index.html        # canvas + painel + overlays de erro/loading
├── style.css         # CSS local enxuto (sem Bootstrap legado)
├── main.js           # composition root: lê UID, orquestra carregamento, conecta world↔dom
├── world.js          # tudo dentro do canvas (Three.js): scene, camera, lights, controls, GLB
├── dom.js            # tudo no HTML ao redor (estruturas, mensagens, loading)
└── loader.js         # rede: fetch GLB do R2 + parse via GLTFLoader
```

**Princípios:**
- Dependências apontam pra dentro: `main.js` conhece os outros, eles não conhecem `main.js`.
- Three.js só vive em `world.js`; DOM só vive em `dom.js`; rede só vive em `loader.js`.
- A ponte 3D↔DOM é um callback explícito (`onToggle(name, bool)` que chama `world.setVisibility(...)`). Cada módulo fica em uma única camada.
- Adicionar camadas quando o problema pede é barato; deletar camadas que sobraram é caro.

### 4. Contratos entre módulos (ES modules)

```js
// loader.js
export async function loadGlb(url) -> { root: THREE.Group, namedMeshes: THREE.Mesh[] }

// world.js
export function init(canvasEl) -> void
export function mount(rootObject) -> void
export function setVisibility(name, visible) -> void
export function frameToScene() -> void

// dom.js
export function showLoading(visible) -> void
export function showError(message) -> void
export function renderStructures(names, onToggle) -> void
```

**Localização do `Map<name, mesh>`:** dentro de `world.js`. `dom.js` só conhece nomes (string); a tradução para mesh é responsabilidade do mundo 3D.

### 5. Stack do Three.js (dentro de `world.js`)

- **Renderer:** `WebGLRenderer({ antialias: true })`, `pixelRatio = min(devicePixelRatio, 2)`
- **Color pipeline:** `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.0` (ajustável depois)
- **Camera:** `PerspectiveCamera`, FOV 45°. `near` e `far` derivados do bounding sphere após carregar o GLB
- **Controls:** `OrbitControls` com `enableDamping: true`, `dampingFactor: 0.05`
- **Lighting:** `RoomEnvironment` do Three.js (procedural, built-in), aplicado via PMREMGenerator como `scene.environment`. Sem HTTP request adicional, sem licença HDRI. Combinado com tone mapping ACES + sRGB, deve ficar visualmente próximo do Sketchfab. Se ficar pobre, escala para HDRI customizado no 3b.
- **Background do canvas (Three.js):** `0x272425` (cor do body do `/case/` atual; o painel lateral fica em `rgb(59, 57, 57)`, lido no `style.css`, não no `world.js`)
- **Render loop:** `requestAnimationFrame` clássico — `controls.update()` + `renderer.render()`
- **Resize:** listener em `window.resize` atualiza `setSize` + `aspect` + `updateProjectionMatrix`

**Frame-to-scene automático:** após `mount(root)`, computar `Box3` da cena, derivar centro e raio. Posicionar câmera a ~2x o raio no eixo Z, `controls.target` no centro, ajustar `near = raio * 0.01` e `far = raio * 100`.

**Por que não Three.js puro com hemisphere/directional:** os materiais que `mesh-processor` gera são PBR (metallic=0, roughness=0.5) — foram desenhados para iluminação por environment map. Sem IBL, ficam visualmente chapados.

**Por que ACES + sRGB:** o Sketchfab parece "Sketchfab" não pela engine (eles usam OSG.JS, não Three.js) mas pelo pipeline de cor: HDR linear → tone mapping cinematográfico → sRGB output. Replicar isso no Three.js é trivial e já cobre ~80% da percepção visual.

### 6. Carregamento do Three.js

**ES modules + import map** apontando para CDN com Three.js + addons fixados em versão.

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.164.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.164.0/examples/jsm/"
  }
}
</script>
```

Mantém o `medCaseViewer` como site estático sem build step. Versão fixada (não `latest`) evita quebras silenciosas.

### 7. Configuração de URL

**Constante única no topo de `main.js`** (mesmo padrão do `upload.js`):

```js
const R2_PUBLIC_BASE = "https://pub-<hash>.r2.dev";  // preencher após ativar Public Access
```

UID lido de `URLSearchParams(window.location.search).get("id")`. URL final do GLB: `${R2_PUBLIC_BASE}/cases/${uid}.glb`. Migração para custom domain no futuro = troca de uma linha.

### 8. Tratamento de erros

Todos via `dom.showError(mensagem)`, overlay sobre o canvas, sem stack trace ao clínico.

| Cenário | Detecção | Mensagem (pt-BR) |
|---|---|---|
| URL sem `?id=` | check no início de `main.js` | "UID do caso não informado na URL." |
| HTTP 404 no R2 | `response.status === 404` no `loader.js` | "Caso não encontrado: `<uid>`." |
| Erro de rede ou CORS | `try/catch` em torno do `fetch` | "Erro ao carregar o modelo. Verifique sua conexão e tente novamente." |
| Parse falhou (GLB corrompido) | `try/catch` em torno do parser | "Arquivo do modelo está corrompido. Contate o suporte." |

Sem retry automático no 3a — usuário recarrega se quiser. Política de retry entra no 3b se observarmos falhas transientes.

### 9. Testes automatizados (Playwright)

**Decisão:** suite Playwright cobrindo 5 cenários essenciais. Roda localmente antes de cada deploy. Tem peso de bloqueador para o critério de aceite — viewer não vai pra produção sem essa rede.

**Por quê:** já houve incidente de o diretor da clínica testar a versão Sketchfab e ela não funcionar. Testes manuais não pegam o tipo de regressão que aparece em produção. Essa rede é a base — Sprint 3b/3c herdarão e expandirão.

**Estrutura:**

```
medCaseViewer/
├── case-next/
│   └── ...
├── tests/
│   └── case-next/
│       ├── case-next.spec.js              # suite E2E
│       └── fixtures/
│           └── sample.glb                  # GLB conhecido, comitado no repo
├── playwright.config.js
└── package.json                            # apenas dev-deps de teste
```

`package.json` entra no repo só para gerenciar Playwright como dev dep. **Nada do site em produção depende de Node ou de build step** — Hostinger continua servindo HTML/CSS/JS estático.

**Casos de teste (5 essenciais para 3a):**

| # | Teste | Verifica | Estratégia |
|---|---|---|---|
| 1 | Smoke — página carrega | Canvas existe e tem conteúdo renderizado (não está preto/vazio) | Intercepta request do GLB, serve `fixtures/sample.glb`. Espera canvas e checa pixels não-pretos |
| 2 | Painel de estruturas renderiza | Lista mostra um item por mesh nomeado do fixture | Assert no DOM: count de itens da lista = nº de meshes do fixture |
| 3 | Toggle esconde/mostra | Clicar no checkbox de uma estrutura faz a cena mudar | Screenshot antes → click → screenshot depois → assert pixels diferentes |
| 4 | URL sem `?id=` mostra erro | Mensagem "UID do caso não informado na URL." | Navegar sem query param, assert texto no overlay |
| 5 | UID inexistente mostra erro | 404 do R2 vira mensagem "Caso não encontrado: ..." | Intercepta request do GLB e responde 404, assert texto no overlay |

**Como gerar o fixture (uma vez só):**
1. Rodar `mesh-processor` localmente com `DRY_RUN=true`
2. Subir uma STL de exemplo (pasta Reynaldo) via `/upload/`
3. Salvar o GLB gerado em `tests/case-next/fixtures/sample.glb` (extrair via instrumentação dedicada no `processor.py` ou via curl + headers `Accept: model/gltf-binary`)
4. Comitar no repo (~1-3 MB esperado)

**Como rodar:**
```bash
npm install                    # uma vez
npx playwright install         # baixa browsers (uma vez)
npx playwright test            # antes de cada git push
```

**CI:** sem GitHub Actions hoje — disciplina manual no 3a. Adicionar Action depois é trivial; entra como follow-up.

**Smoke de produção** (fora do escopo do 3a, registrado como follow-up): teste Playwright separado apontando para `https://biodesignlab.com.br/case-next/?id=<uid-real>` após cada deploy. Esse seria o teste que pegaria o tipo de falha do incidente do diretor. Implementação concreta fica para 3b ou 3c.

### 10. Validação manual (após os testes passarem)

**Pré-condições:**
- R2 Public Access ativado no painel Cloudflare
- `R2_PUBLIC_BASE` preenchido em `main.js`
- Pelo menos um GLB em R2 — exige um upload novo via `/upload/` (casos pré-Sprint-2 só estão no Sketchfab)

**Setup:** VS Code Live Server na pasta `medCaseViewer/` (porta 5500 ou 5501). CORS no `mesh-processor` já libera essas origens.

**Acceptance flow:**
1. Abrir `http://127.0.0.1:5500/case-next/?id=<uid-recente>` → modelo carrega e renderiza
2. Painel mostra um item por mesh nomeado, com checkbox marcado
3. Desmarcar checkbox → estrutura desaparece da cena. Marcar de novo → reaparece
4. URL sem `?id=` → mensagem "UID do caso não informado na URL."
5. UID inexistente → mensagem "Caso não encontrado: ..."
6. Modelo renderizado tem aparência razoavelmente próxima do Sketchfab (ACES + RoomEnvironment); tuning fino é iterativo

---

## O que **não** está no escopo do 3a

Itens deliberadamente fora — entram no 3b ou depois:

- Medição linear (point-to-point no mesh)
- Slider de opacidade por estrutura
- Anotações 3D ancoradas
- Export de laudo PDF
- Tema claro/escuro / botão de mudar fundo
- Botão de embed de vídeo do YouTube
- Reconciliação de casos pré-Sprint-2 (só no Sketchfab) — entra no 3c
- Modificação do `/case/` atual — só acontece no 3c
- Mudanças no `mesh-processor` — backend está pronto desde o Sprint 2
- Custom domain ou Cloudflare Worker para os assets do R2 — entra no 3b/3c
- Smoke test de produção pós-deploy
- GitHub Actions / CI

---

## Riscos e mitigação

1. **Aparência visual fica longe do Sketchfab.** Mitigação: `RoomEnvironment` + ACES + sRGB já cobrem ~80%; se sobrar gap perceptível, 3b adota HDRI customizado.
2. **`pub-<hash>.r2.dev` rate-limita em volume.** Mitigação: volume clínico atual é baixo (poucos casos/dia). Trigger para migrar para custom domain: primeiro caso de rate limit observado, ou início do 3b.
3. **CORS no R2.** Confirmado durante validação manual de 2026-04-29: **R2 default NÃO envia headers CORS** — bloqueia qualquer request cross-origin do navegador (status 200 chega, mas `Access-Control-Allow-Origin` ausente faz o browser descartar). Mitigação **obrigatória**, não opcional: configurar política CORS no painel Cloudflare antes da primeira validação manual. Política aplicada: `AllowedOrigins` = `http://127.0.0.1:5500`, `http://localhost:5500`, `http://127.0.0.1:5501`, `http://localhost:5501`, `https://biodesignlab.com.br`; `AllowedMethods` = `GET`, `HEAD`; `MaxAgeSeconds` = 3600.
4. **GLB grande trava o navegador no parse.** Mitigação: limite de 60 MB no upload já protege; se aparecer caso pesado, 3b adota Web Worker para parse.
5. **Fixture do teste fica desatualizado em relação ao formato real do GLB.** Mitigação: regenerar fixture sempre que `processor.py` mudar (ex: novo schema de material). Anotar no `processor.py`'s CLAUDE.md como dependência.

---

## Próximos passos depois deste spec

1. User revisa este spec; ajustes inline conforme feedback
2. Invocar `superpowers:writing-plans` para gerar o plano de implementação detalhado
3. Implementação acontece módulo por módulo, no ritmo *concept → code → run → next* — nunca dump de múltiplos arquivos de uma vez
