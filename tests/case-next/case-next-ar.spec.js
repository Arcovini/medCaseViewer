import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");

const TEST_UID = "test-fixture-ar";

async function fixtureBytes() {
  return fs.readFile(FIXTURE_PATH);
}

// Intercepta o GLB do R2 e responde com o fixture local.
async function mockGlbRoute(page) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    const body = await fixtureBytes();
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body,
    });
  });
}

// Setup do ambiente AR — precisa rodar via `addInitScript` (antes de qualquer
// JS do app), por dois motivos:
//   1. Registrar a fake <model-viewer> antes do main.js / ar.js executar.
//      `customElements.define` não pode ser chamado duas vezes pro mesmo
//      nome, e o script real do model-viewer faz exatamente isso.
//   2. Substituir o user-agent (alguns testes precisam UA iOS / Android).
//
// Importante: cada arg passado precisa ser serializável JSON. UA string vai
// como `ua: "iPhone..."`, `null` se não quisermos sobrescrever.
async function setupARFakes(page, opts = {}) {
  const {
    canActivateAR = true,
    ua = null,
    failModelViewerImport = false,
    neverFireLoadEvent = false,
    holdUsdzExport = false,
  } = opts;

  await page.addInitScript(({ canAR, uaOverride, failMV, neverLoad, holdUsdz }) => {
    window.__playwrightTest = true;
    window.__activateARCalled = 0;
    window.__lastIosSrc = null;
    window.__lastSrc = null;
    window.__lastQRUrl = null;
    window.__usdzExportCount = 0;

    if (uaOverride) {
      Object.defineProperty(navigator, "userAgent", {
        get: () => uaOverride,
        configurable: true,
      });
      // No iPad-modo-desktop test, usaremos um UA Macintosh + maxTouchPoints
      // forçado. Para casos comuns, mantemos maxTouchPoints zero (desktop).
      if (uaOverride.includes("iPad-as-Mac")) {
        Object.defineProperty(navigator, "userAgent", {
          get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          configurable: true,
        });
        Object.defineProperty(navigator, "maxTouchPoints", {
          get: () => 5,
          configurable: true,
        });
      }
    }

    // Fake <model-viewer> custom element. Implementa só o que ar.js usa:
    // - propriedade canActivateAR (getter, controlado pelo teste)
    // - método activateAR() (registra chamada + último ios-src/src observados)
    // - dispara evento `load` async após connect (a menos que neverLoad=true)
    class FakeModelViewer extends HTMLElement {
      get canActivateAR() { return canAR; }
      activateAR() {
        window.__activateARCalled++;
        window.__lastIosSrc = this.getAttribute("ios-src");
        window.__lastSrc = this.getAttribute("src");
        return Promise.resolve();
      }
      connectedCallback() {
        if (!neverLoad) {
          // 30ms é suficiente pra ar.init aguardar antes do timeout.
          setTimeout(() => this.dispatchEvent(new Event("load")), 30);
        }
      }
    }
    if (!customElements.get("model-viewer")) {
      customElements.define("model-viewer", FakeModelViewer);
    }

    // Mock import dinâmico de @google/model-viewer (substitui o fetch CDN).
    if (failMV) {
      window.__mockModelViewerImport = () => Promise.reject(new Error("network blocked"));
    } else {
      window.__mockModelViewerImport = () => Promise.resolve({});
    }

    // Mock import dinâmico de qrcode — captura URL passada e retorna PNG fake.
    window.__mockQRCodeImport = () => Promise.resolve({
      default: {
        toDataURL: async (url, _opts) => {
          window.__lastQRUrl = url;
          return "data:image/png;base64,FAKE_QR_PNG";
        },
      },
    });

    // Com holdUsdz, a exportação só termina quando o teste chamar
    // window.__releaseUsdzExport(): o "gerando USDZ" dura o quanto o teste
    // precisar, em vez de ser uma janela de tempo que ele tenta flagrar.
    window.__usdzExportGate = holdUsdz
      ? new Promise((resolve) => { window.__releaseUsdzExport = resolve; })
      : null;

    // Mock USDZExporter — não baixa o módulo Three.js do unpkg (lento + ruidoso
    // em CI). Retorna bytes mínimos válidos pra Blob.
    window.__lastExportedSceneScale = null;
    window.__lastExportedMaxCoord = null;
    window.__mockUSDZExporterImport = () => Promise.resolve({
      USDZExporter: class FakeUSDZExporter {
        async parseAsync(scene) {
          window.__usdzExportCount++;
          window.__lastExportedSceneScale = scene?.scale
            ? { x: scene.scale.x, y: scene.scale.y, z: scene.scale.z }
            : null;
          // Max absolute component of any vertex position in the exported scene.
          // The 0.001 mm→m factor is baked into each BufferGeometry (the root
          // group's scale stays at 1), so this measures whether the bake
          // actually happened in geometry space.
          let maxCoord = 0;
          scene.traverse((obj) => {
            if (obj.isMesh && obj.geometry?.attributes?.position) {
              const p = obj.geometry.attributes.position;
              for (let i = 0; i < p.count; i++) {
                const x = Math.abs(p.getX(i));
                const y = Math.abs(p.getY(i));
                const z = Math.abs(p.getZ(i));
                if (x > maxCoord) maxCoord = x;
                if (y > maxCoord) maxCoord = y;
                if (z > maxCoord) maxCoord = z;
              }
            }
          });
          window.__lastExportedMaxCoord = maxCoord;
          if (window.__usdzExportGate) await window.__usdzExportGate;
          return new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP header (USDZ é zip)
        }
      },
    });
  }, {
    canAR: canActivateAR,
    uaOverride: ua,
    failMV: failModelViewerImport,
    neverLoad: neverFireLoadEvent,
    holdUsdz: holdUsdzExport,
  });

  await mockGlbRoute(page);
}

// Espera ar.init() finalizar (success ou silent-fail).
async function waitForArReady(page) {
  await page.waitForFunction(() => window.__ar && window.__ar.isReady(), null, { timeout: 10_000 });
}

// Espera o GLB carregar (sinal: panel populado).
async function waitForGlbLoaded(page) {
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";

// =============================================================================
// 1. Visibilidade do botão por plataforma e capacidade
// =============================================================================

test("Android com canActivateAR=true: botão AR aparece", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

test("Android sem AR (canActivateAR=false): botão AR fica oculto", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: false, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "false");
});

test("iOS com canActivateAR=true: botão AR aparece", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

test("iOS com canActivateAR=false: botão AR aparece mesmo assim", async ({ page }) => {
  // <model-viewer>.canActivateAR só vira true no iOS se `ios-src` estiver
  // presente, e geramos o USDZ on-demand no click (não no init). Pra evitar
  // que o botão fique permanentemente oculto no iOS real, confiamos na
  // plataforma — qualquer iOS 12+ suporta Quick Look.
  await setupARFakes(page, { canActivateAR: false, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

test("falha em carregar model-viewer NÃO bloqueia o panel (silent-fail)", async ({ page }) => {
  await setupARFakes(page, { failModelViewerImport: true });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  // panel renderizou (já validado em waitForGlbLoaded), e botão AR fica oculto
  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "false");
});

test("timeout do load do model-viewer NÃO trava a UI nem o botão", async ({ page }) => {
  // O ar.js espera 6 s pelo `load` antes de seguir. Sem test.setTimeout: o
  // antigo 25 s era de quando o padrão era 15 s e, com o padrão em 45 s
  // (playwright.config.js), passou a encurtar este teste — no desktop, carga +
  // 6 s + um clique passam dos 25 s na suíte cheia.
  // Aqui setamos neverFireLoadEvent: o evento `load` nunca dispara. ar.init
  // tolera o timeout e segue — botão fica visível baseado na plataforma.
  await setupARFakes(page, { neverFireLoadEvent: true });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  // Aguardar um pouco a mais que o timeout do model-viewer load (6s)
  await page.waitForFunction(() => window.__ar && window.__ar.isReady(), null, { timeout: 12_000 });

  // Painel ainda interativo: clique no primeiro eye-toggle deve esconder a estrutura
  const firstButton = page.locator(".eye-toggle").first();
  const name = await firstButton.getAttribute("data-structure-name");
  await firstButton.click();
  const visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(false);

  // Botão AR continua visível: no projeto mobile (UA iPhone13) por iOS sempre
  // mostrar, e no projeto desktop (UA Chrome desktop) por QR fallback.
  // No iOS, Quick Look funciona via ios-src on-demand independente do load.
  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

// =============================================================================
// 2. Modal QR no desktop
// O projeto Playwright "mobile" usa UA iPhone13 — o classifyPlatform vê iOS,
// não desktop. Esses testes são desktop-específicos por design (QR é o caminho
// de fallback do desktop quando o clínico precisa abrir no celular).
// =============================================================================

test.describe("desktop QR modal", () => {
  test.beforeEach(async ({ }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop-only flow");
  });

  test("desktop: clicar no botão abre o modal QR", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await page.locator(".ar-button").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "true");
  });

  test("desktop: URL passada ao QR contém o id atual", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await page.locator(".ar-button").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "true");

    const qrUrl = await page.evaluate(() => window.__lastQRUrl);
    expect(qrUrl).toContain(`id=${TEST_UID}`);
    expect(qrUrl).toContain("/case/");
    // ar=1: quem escaneia cai no convite "Ver em AR" (seção 6).
    expect(new URL(qrUrl).searchParams.get("ar")).toBe("1");
  });

  test("desktop: abrir o link com ar=1 no computador não mostra o convite", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}&ar=1`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await expect(page.locator(".ar-prompt")).toHaveCount(0);
    await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
  });

  test("desktop: modal QR fecha pelo botão ✕", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await page.locator(".ar-button").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "true");

    await page.locator(".ar-modal-close").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "false");
  });

  test("desktop: modal QR fecha pelo backdrop", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await page.locator(".ar-button").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "true");

    // Click direto no overlay (não no .ar-modal-content)
    // Posicionamento padrão do modal usa flex centering, então o backdrop é
    // qualquer canto da viewport.
    await page.mouse.click(10, 10);
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "false");
  });

  test("desktop: modal QR fecha pelo Escape", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    await page.locator(".ar-button").click();
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator(".ar-modal")).toHaveAttribute("data-visible", "false");
  });

  test("desktop: botão AR aparece após carregamento (modo QR)", async ({ page }) => {
    await setupARFakes(page, { canActivateAR: false });
    await page.goto(`/case/?id=${TEST_UID}`);
    await waitForGlbLoaded(page);
    await waitForArReady(page);

    const btn = page.locator(".ar-button");
    await expect(btn).toHaveAttribute("data-visible", "true");
    await expect(btn).toHaveText("AR");
  });
});

// =============================================================================
// 3. Activação AR mobile (iOS / Android)
// =============================================================================

test("Android: clicar dispara activateAR sem mexer em ios-src", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });

  const lastIosSrc = await page.evaluate(() => window.__lastIosSrc);
  const lastSrc = await page.evaluate(() => window.__lastSrc);
  expect(lastIosSrc).toBeNull();   // Android nunca seta ios-src
  expect(lastSrc).toContain(`/cases/${TEST_UID}.glb`);
});

test("iOS: clicar gera USDZ e dispara activateAR com ios-src=blob:", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });

  const lastIosSrc = await page.evaluate(() => window.__lastIosSrc);
  expect(lastIosSrc).toMatch(/^blob:/);

  const exportCount = await page.evaluate(() => window.__usdzExportCount);
  expect(exportCount).toBe(1);
});

test("iOS: USDZ exportado em escala metro (mm bake 0.001 em geometry, scene.scale = 1)", async ({ page }) => {
  // GLBs do mesh-processor vêm em milímetros e o Quick Look interpreta
  // USDZ como metros. Sem o reescalonamento, o modelo aparece 1000x maior
  // no AR ("room-size complaint").
  //
  // O Three.js USDZExporter NÃO emite Xform pra nós sem geometria, então
  // setar scale só no Group raiz é silenciosamente descartado no export.
  // O fix: bake da escala 0.001 em cada BufferGeometry e zerar a scale
  // do Group raiz. Este teste valida ambas as metades do contrato.
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  // Mede o maior valor absoluto de vértice antes do bake (referência).
  const originalMax = await page.evaluate(() => {
    let m = 0;
    window.__world.getMountedRoot().traverse((obj) => {
      if (obj.isMesh && obj.geometry?.attributes?.position) {
        const p = obj.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = Math.abs(p.getX(i));
          const y = Math.abs(p.getY(i));
          const z = Math.abs(p.getZ(i));
          if (x > m) m = x; if (y > m) m = y; if (z > m) m = z;
        }
      }
    });
    return m;
  });

  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });

  const exportedScale = await page.evaluate(() => window.__lastExportedSceneScale);
  const exportedMax   = await page.evaluate(() => window.__lastExportedMaxCoord);

  // Group raiz zerado pós-bake: nada de Xform sobrando que o exporter dropparia.
  expect(exportedScale).not.toBeNull();
  expect(exportedScale.x).toBeCloseTo(1, 5);
  expect(exportedScale.y).toBeCloseTo(1, 5);
  expect(exportedScale.z).toBeCloseTo(1, 5);

  // Bake aconteceu nas geometrias — vértices encolheram por ~1000.
  expect(exportedMax).toBeGreaterThan(0);
  if (originalMax > 0) {
    expect(exportedMax).toBeLessThan(originalMax / 100);
  }
});

test("iOS: USDZ é memoizado — segundo clique reusa o mesmo blob URL", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });
  const firstIosSrc = await page.evaluate(() => window.__lastIosSrc);

  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 2, null, { timeout: 5_000 });
  const secondIosSrc = await page.evaluate(() => window.__lastIosSrc);

  expect(secondIosSrc).toBe(firstIosSrc);
  const exportCount = await page.evaluate(() => window.__usdzExportCount);
  expect(exportCount).toBe(1); // Não regenerou USDZ
});

test("iOS: botão mostra estado loading durante geração de USDZ", async ({ page }) => {
  // A exportação fica presa até o teste soltá-la. Com um atraso fixo (800 ms)
  // o teste disputava corrida com a janela: no desktop o próprio clique leva
  // ~5 s e a primeira leitura do atributo já chegava depois do fim.
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS, holdUsdzExport: true });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  const btn = page.locator(".ar-button");
  await btn.click();

  // Exportação em andamento: loading ligado e o AR ainda não foi aberto.
  await expect(btn).toHaveAttribute("data-loading", "true");
  expect(await page.evaluate(() => window.__activateARCalled)).toBe(0);

  await page.evaluate(() => window.__releaseUsdzExport());

  // Quando activateAR é chamado, loading deve ter voltado pra false.
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });
  await expect(btn).toHaveAttribute("data-loading", "false");
});

// =============================================================================
// 4. Preservação de estado e isolamento
// =============================================================================

test("preservação: clicar AR não afeta o painel ou eye-toggles", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  // Esconde uma estrutura antes do click AR
  const firstToggle = page.locator(".eye-toggle").first();
  const name = await firstToggle.getAttribute("data-structure-name");
  await firstToggle.click();
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(false);

  // Click AR
  await page.locator(".ar-button").click();
  await page.waitForFunction(() => window.__activateARCalled === 1);

  // Verifica que o estado foi preservado
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(false);
  await expect(firstToggle).toHaveAttribute("data-visible", "false");

  // Clicar de novo no toggle continua funcionando
  await firstToggle.click();
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(true);
});

test("isolation: /upload/ não carrega o módulo ar.js nem registra <model-viewer>", async ({ page }) => {
  // Não setamos as fakes — queremos verificar que /upload/ é um bundle separado.
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await page.goto(`/upload/`);

  // Aguarda render do upload page
  await expect(page.locator("body")).toBeVisible();

  // Nenhum <model-viewer> no DOM
  const modelViewerCount = await page.evaluate(() => document.querySelectorAll("model-viewer").length);
  expect(modelViewerCount).toBe(0);

  // Nenhum custom element registrado pra "model-viewer"
  const isRegistered = await page.evaluate(() => !!customElements.get("model-viewer"));
  expect(isRegistered).toBe(false);

  // window.__ar não existe (módulo ar.js não foi importado)
  const hasArModule = await page.evaluate(() => typeof window.__ar !== "undefined");
  expect(hasArModule).toBe(false);
});

// =============================================================================
// 5. Estado oculto durante carregamento
// =============================================================================

test("botão AR não existe no DOM antes do GLB carregar", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_ANDROID });
  // Atrasa a resposta do GLB em 3s pra criar uma janela ampla onde o panel
  // ainda não foi renderizado — ar.init só roda após dom.renderStructures.
  await page.unroute(`**/cases/${TEST_UID}.glb`);
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    const body = await fixtureBytes();
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body });
  });

  await page.goto(`/case/?id=${TEST_UID}`);

  // Janela de loading: o pill AR existe no markup estático do shell v5, mas
  // continua oculto (data-visible="false") porque ar.init() ainda não rodou
  // — só depois do GLB e renderStructures que main.js chama ar.init.
  await page.waitForTimeout(800);
  await expect(page.locator("#loading")).toBeVisible();
  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "false");

  // Após GLB carregar e ar.init terminar, botão aparece
  await waitForGlbLoaded(page);
  await waitForArReady(page);
  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

// =============================================================================
// 6. Convite em tela cheia — caso aberto pelo QR (…&ar=1) no celular
// =============================================================================

const prompt = (page) => page.locator('[data-testid="ar-prompt"]');
const promptOpen = (page) => page.locator('[data-testid="ar-prompt-open"]');
const promptDismiss = (page) => page.locator('[data-testid="ar-prompt-dismiss"]');

test("ar=1 no iOS: convite pronto com o USDZ já gerado; o toque abre o AR", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);

  await expect(prompt(page)).toHaveAttribute("data-visible", "true");
  await expect(prompt(page)).toHaveAttribute("data-state", "ready");
  await expect(promptOpen(page)).toHaveText("Ver em AR");
  // A conversão aconteceu antes do toque.
  expect(await page.evaluate(() => window.__usdzExportCount)).toBe(1);
  expect(await page.evaluate(() => window.__activateARCalled)).toBe(0);

  await promptOpen(page).click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });

  expect(await page.evaluate(() => window.__lastIosSrc)).toMatch(/^blob:/);
  expect(await page.evaluate(() => window.__usdzExportCount)).toBe(1); // não converteu de novo
  await expect(prompt(page)).toHaveAttribute("data-visible", "false");
});

test("ar=1 no iOS: enquanto o USDZ é gerado o botão fica travado em 'Preparando…'", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS, holdUsdzExport: true });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(prompt(page)).toHaveAttribute("data-state", "loading");
  await expect(promptOpen(page)).toBeDisabled();
  await expect(promptOpen(page)).toHaveText("Preparando…");

  await page.evaluate(() => window.__releaseUsdzExport());

  await expect(prompt(page)).toHaveAttribute("data-state", "ready");
  await expect(promptOpen(page)).toBeEnabled();
});

test("ar=1 no Android com AR: o toque dispara activateAR e o convite sai", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);

  await expect(prompt(page)).toHaveAttribute("data-state", "ready");
  await promptOpen(page).click();
  await page.waitForFunction(() => window.__activateARCalled === 1, null, { timeout: 5_000 });

  expect(await page.evaluate(() => window.__lastIosSrc)).toBeNull();
  await expect(prompt(page)).toHaveAttribute("data-visible", "false");
});

test("ar=1 no Android sem AR: aviso, sem botão de AR, e 'Ver o modelo 3D' leva ao visualizador", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: false, ua: UA_ANDROID });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);

  await expect(prompt(page)).toHaveAttribute("data-state", "unsupported");
  await expect(prompt(page)).toContainText("não abre realidade aumentada");
  await expect(promptOpen(page)).toBeHidden();

  await promptDismiss(page).click();
  await expect(prompt(page)).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__activateARCalled)).toBe(0);
  // Visualizador normal por baixo: o painel de estruturas está lá.
  await expect(page.locator("#structures-list li")).toHaveCount(4);
});

test("ar=1: 'Ver o modelo 3D' fecha o convite e o botão AR continua na barra", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);

  await expect(prompt(page)).toHaveAttribute("data-state", "ready");
  await promptDismiss(page).click();

  await expect(prompt(page)).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__activateARCalled)).toBe(0);
  await expect(page.locator(".ar-button")).toHaveAttribute("data-visible", "true");
});

test("ar=1 com falha do model-viewer: o convite vira o aviso e não prende a tela", async ({ page }) => {
  await setupARFakes(page, { failModelViewerImport: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}&ar=1`);
  await waitForGlbLoaded(page);

  await expect(prompt(page)).toHaveAttribute("data-state", "unsupported");
  await promptDismiss(page).click();
  await expect(prompt(page)).toHaveAttribute("data-visible", "false");
});

test("sem ar=1 no celular: o convite não existe", async ({ page }) => {
  await setupARFakes(page, { canActivateAR: true, ua: UA_IOS });
  await page.goto(`/case/?id=${TEST_UID}`);
  await waitForGlbLoaded(page);
  await waitForArReady(page);

  await expect(page.locator(".ar-prompt")).toHaveCount(0);
});
