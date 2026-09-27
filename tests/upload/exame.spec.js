/* Área única de envio: estruturas e exame entram pelo mesmo lugar e a página
 * separa pelo conteúdo; o exame vira uma lista de séries (a escolha do
 * clínico); o envio manda uma série por request.
 *
 * Como divisao.spec.js: os testes que dependem de rede precisam do backend
 * local em DRY_RUN na porta 8000 e se PULAM sem ele.
 *
 * Fixtures (mesh-processor/scripts/upload_fixtures.py e test_exam.make_slice):
 *   fixtures/dicom/IM0001…IM0008 — série "Fixture 8 imagens" 16×16×8, sem extensão
 *   fixtures/multi/ — um "CD": ARTERIAL (10, FoR A), NEFROGRAFICA (12, FoR A),
 *     ANGIO TORAX (9, FoR B = outro exame), PORTAL (falta a 5ª imagem),
 *     LOCALIZADOR (2), VIEWER.EXE e index.html
 *   fixtures/multi.zip — a mesma pasta compactada
 *   fixtures/crua/ — 8 imagens sem o preâmbulo DICM (VR implícito cru)
 *   fixtures/mpr/ — coronal de 10 fatias + 1 imagem LOCALIZER na mesma série
 *   fixtures/misto.zip (STL + DICOM), fixtures/stl.zip (STL compactado)
 *   ../case-next/fixtures/exam-sphere.nrrd — NRRD canônico 64×56×48
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(__dirname, "fixtures", n);
const filesIn = (dir) => fs.readdirSync(dir, { recursive: true })
  .map((n) => path.join(dir, n))
  .filter((p) => fs.statSync(p).isFile())
  .sort();
const DICOM = filesIn(fx("dicom"));
const MULTI_DIR = fx("multi");
const MULTI = filesIn(MULTI_DIR);
const CRUA = filesIn(fx("crua"));
const NRRD = path.join(__dirname, "../case-next/fixtures/exam-sphere.nrrd");
const RIM = fx("Rim.stl");

const BACKEND = "http://localhost:8000";
const COMO_SUBIR =
  "backend ausente: DRY_RUN=true uvicorn main:app --port 8000 no repo mesh-processor";

let backendUp = false;
test.beforeAll(async ({ request }) => {
  try {
    backendUp = (await request.get(`${BACKEND}/health`, { timeout: 2000 })).ok();
  } catch {
    backendUp = false;
  }
});

async function abrirUpload(page) {
  await page.goto("/upload/");
  await expect(page.locator("#state-idle")).toBeVisible();
}

const escolher = (page, files) => page.setInputFiles('[data-testid="file-input"]', files);
const processar = (page) => page.locator("#btn-process");
const resumo = (page) => page.locator('[data-testid="exam-summary"]');
const erroExame = (page) => page.locator("#exam-error");
const erroArea = (page) => page.locator("#drop-error");
const serie = (page, nome) => page.locator(".up-series-row", { hasText: nome });
const lido = (page) => page.waitForFunction(() => !window.__upload.isReading() && window.__upload.getExam());

// Quantas entradas tem o .zip dentro de um corpo multipart (lê o fim do .zip).
function zipEntries(body) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const at = body.lastIndexOf(sig);
  return at < 0 ? null : body.readUInt16LE(at + 10);
}

test.describe("área única (sem rede)", () => {
  test("só o NRRD já habilita Processar", async ({ page }) => {
    await abrirUpload(page);
    await expect(processar(page)).toBeDisabled();
    await escolher(page, NRRD);
    await expect(resumo(page)).toHaveText(/^exam-sphere · NRRD · 48 imagens · 2 mm · \d+ KB$/);
    await expect(processar(page)).toBeEnabled();
  });

  test("STL e DICOM soltos juntos: cada um na sua seção", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, ...DICOM]);
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    await expect(resumo(page)).toHaveText(/^Fixture 8 imagens · RM · 8 imagens/);
    await expect(page.locator("#drop")).toHaveAttribute("data-compact", "true");
    await expect(processar(page)).toBeEnabled();
  });

  test("DICOM sem o preâmbulo (VR implícito cru) é reconhecido", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, CRUA);
    await expect(resumo(page)).toHaveText(/^CRUA · RM · 8 imagens/);
  });

  test("as levas se somam: STL, depois o exame, depois outra fase", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, RIM);
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    await escolher(page, filesIn(path.join(MULTI_DIR, "arterial")));
    await expect(resumo(page)).toHaveText(/^ARTERIAL 1\.0/);
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    // A outra fase, numa pasta separada: vira a segunda série, e a escolha feita fica.
    await escolher(page, filesIn(path.join(MULTI_DIR, "nefro")));
    await lido(page);
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("2 séries");
    await expect(serie(page, "ARTERIAL")).toContainText("usada na segmentação");
    await expect(serie(page, "NEFROGRAFICA").locator('input[type="checkbox"]')).not.toBeChecked();
  });

  test("estruturas que chegam depois revalidam a escolha de séries", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, MULTI);
    await lido(page);
    await serie(page, "ANGIO TORAX").locator('input[type="checkbox"]').check();
    await escolher(page, RIM);
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    // Com estruturas, a série de outro exame sai da escolha e a pergunta muda.
    await expect(serie(page, "ANGIO TORAX").locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(serie(page, "ANGIO TORAX").locator('input[type="checkbox"]')).toBeDisabled();
    await expect(serie(page, "NEFROGRAFICA")).toContainText("usada na segmentação");
  });

  test("soltar estruturas durante a leitura do exame não trava a página", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, MULTI);
    await escolher(page, RIM); // antes de a leitura acabar
    await lido(page);
    await expect(page.locator("#exam-reading")).toBeHidden();
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("4 séries");
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    await expect(processar(page)).toBeEnabled();
  });

  test("pasta de CD: séries agrupadas, localizador e lixo de fora", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, MULTI);
    await lido(page);
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("4 séries");
    await expect(page.locator('[data-testid="exam-ignored"]')).toContainText("4 arquivos ignorados");
    // Pré-seleção: só a série com mais imagens, e ela abre primeiro.
    await expect(serie(page, "NEFROGRAFICA").locator('input[type="checkbox"]')).toBeChecked();
    await expect(serie(page, "NEFROGRAFICA")).toContainText("abre primeiro");
    await expect(serie(page, "ARTERIAL").locator('input[type="checkbox"]')).not.toBeChecked();
    // A série com imagem faltando fica desativada com o motivo do servidor.
    await expect(serie(page, "PORTAL").locator('input[type="checkbox"]')).toBeDisabled();
    await expect(serie(page, "PORTAL")).toContainText("espaçamento irregular");
    // Sem estruturas, a de outro exame pode entrar.
    await expect(serie(page, "ANGIO TORAX").locator('input[type="checkbox"]')).toBeEnabled();
  });

  test("com estruturas, a série de outro exame fica de fora", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, ...MULTI]);
    await lido(page);
    await expect(serie(page, "NEFROGRAFICA")).toContainText("usada na segmentação");
    await expect(serie(page, "ANGIO TORAX").locator('input[type="checkbox"]')).toBeDisabled();
    await expect(serie(page, "ANGIO TORAX")).toContainText("Outro exame: não alinha com as estruturas");
    // Trocar a da segmentação: a marca muda de linha.
    await serie(page, "ARTERIAL").locator('input[type="checkbox"]').check();
    await serie(page, "ARTERIAL").getByRole("button", { name: /segmentação/ }).click();
    await expect(serie(page, "ARTERIAL")).toContainText("usada na segmentação");
    await expect(serie(page, "NEFROGRAFICA")).not.toContainText("usada na segmentação");
    await expect(page.locator('[data-testid="exam-send"]')).toHaveText("Vai enviar 2 séries, uma por vez.");
  });

  test("no máximo 4 séries por caso", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [...MULTI, ...CRUA, ...DICOM]);
    await lido(page);
    for (const nome of ["ARTERIAL", "ANGIO TORAX", "CRUA"]) {
      await serie(page, nome).locator('input[type="checkbox"]').check();
    }
    await expect(serie(page, "Fixture").locator('input[type="checkbox"]')).toBeDisabled();
    await expect(serie(page, "Fixture")).toContainText("O caso já tem 4 séries");
  });

  test("reconstrução com imagem de referência (LOCALIZER) na série é aceita", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, filesIn(fx("mpr")));
    await expect(resumo(page)).toHaveText(/^CORONAL MPR · RM · 10 imagens/);
    await expect(page.locator('[data-testid="exam-ignored"]')).toContainText("1 arquivo ignorado");
    await expect(processar(page)).toBeEnabled();
  });

  test(".zip do exame é lido sem descompactar tudo", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, fx("multi.zip"));
    await lido(page);
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("4 séries");
  });

  test(".zip com estruturas e exame juntos pede para separar", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, fx("misto.zip"));
    await expect(erroArea(page)).toContainText("estruturas e exame juntos");
    await expect(processar(page)).toBeDisabled();
  });

  test(".zip de STL pede os arquivos soltos", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, fx("stl.zip"));
    await expect(erroArea(page)).toContainText("Descompacte");
  });

  test("nada reconhecível: a área diz o que espera", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, { name: "VIEWER.EXE", mimeType: "application/octet-stream", buffer: Buffer.alloc(64) });
    await expect(erroArea(page)).toContainText("Nenhum arquivo de estrutura");
  });

  test("série curta demais: o navegador já avisa", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, DICOM.slice(0, 3));
    await expect(erroExame(page)).toContainText("só 3 imagem(ns)");
    await expect(processar(page)).toBeDisabled();
  });

  test("Remover tira só o exame; Cancelar começa de novo", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, ...DICOM]);
    await expect(resumo(page)).toHaveText(/8 imagens/);
    await page.locator("#exam-clear").click();
    await expect(page.locator("#exam-pick")).toBeHidden();
    await expect(page.locator("#structure-list .up-row")).toHaveCount(1);
    await escolher(page, DICOM);
    await expect(resumo(page)).toHaveText(/8 imagens/);
    await page.locator("#btn-cancel").click();
    await expect(page.locator("#exam-pick")).toBeHidden();
    await expect(page.locator("#structures")).toBeHidden();
    await expect(page.locator("#drop")).toHaveAttribute("data-compact", "false");
  });

  test("Escolher uma pasta lê a pasta inteira", async ({ page, isMobile }) => {
    test.skip(isMobile, "o seletor de pastas só existe no desktop");
    await abrirUpload(page);
    await page.setInputFiles('[data-testid="folder-input"]', MULTI_DIR);
    await lido(page);
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("4 séries");
  });
});

test.describe("envio real (backend em DRY_RUN)", () => {
  test.beforeEach(() => test.skip(!backendUp, COMO_SUBIR));

  test("caso só com exame: link direto, sem esperar processamento", async ({ page }) => {
    const status = [];
    page.on("request", (r) => { if (r.url().includes("/status/")) status.push(r.url()); });
    let corpo = null;
    page.on("request", (r) => {
      if (r.url().endsWith("/upload") && r.method() === "POST") corpo = r.postDataBuffer();
    });
    await abrirUpload(page);
    await escolher(page, DICOM);
    await processar(page).click();
    await expect(page.locator("#state-done")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#viewer-url")).toHaveValue(/\/case\/\?id=[0-9a-f]{32}$/);
    await expect(page.locator('[data-testid="done-series"]')).toContainText("16 × 16 × 8");
    await expect(page.locator("#done-intro")).toContainText("abre o exame");
    expect(status).toHaveLength(0);
    // A série vai como um .zip montado na página, no campo `exam`.
    const texto = corpo.toString("latin1");
    expect(texto).toContain('name="exam"; filename="serie.zip"');
    expect(texto).not.toContain('name="files"');
    expect(zipEntries(corpo)).toBe(8);
  });

  test("estruturas + NRRD: um caso só, exame incluído", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, NRRD]);
    await expect(page.locator("#structure-list")).toHaveAttribute("data-overlaps", "done", { timeout: 20_000 });
    await processar(page).click();
    await expect(page.locator("#state-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="done-series"]')).toContainText("64 × 56 × 48");
    await expect(page.locator("#done-intro")).toContainText("modelo 3D");
  });

  test("duas séries: a da segmentação no /upload, a outra no endpoint do caso", async ({ page }) => {
    const envios = [];
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      if (r.url().endsWith("/upload") || /\/cases\/[0-9a-f]{32}\/exam$/.test(r.url())) {
        envios.push({ url: r.url(), corpo: r.postDataBuffer() });
      }
    });
    await abrirUpload(page);
    await escolher(page, [RIM, ...MULTI]);
    await lido(page);
    await serie(page, "ARTERIAL").locator('input[type="checkbox"]').check();
    await processar(page).click();
    await expect(page.locator("#state-done")).toBeVisible({ timeout: 40_000 });
    const linhas = page.locator('[data-testid="done-series"] li');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toContainText("NEFROGRAFICA");
    await expect(linhas.nth(0)).toContainText("usada na segmentação");
    await expect(linhas.nth(1)).toContainText("ARTERIAL");
    await expect(page.locator("#done-exam-title")).toHaveText(/2 de 2 séries incluídas/i);

    expect(envios).toHaveLength(2);
    expect(envios[0].url).toMatch(/\/upload$/);
    expect(zipEntries(envios[0].corpo)).toBe(12); // só a NEFROGRAFICA
    expect(envios[1].url).toMatch(/\/cases\/[0-9a-f]{32}\/exam$/);
    const segundo = envios[1].corpo.toString("latin1");
    expect(segundo).toMatch(/name="index"\r\n\r\n1\r\n/);
    expect(segundo).toContain('name="write_token"');
    expect(zipEntries(envios[1].corpo)).toBe(10); // só a ARTERIAL
  });

  test("série extra que falha: Tentar de novo reenvia só ela", async ({ page }) => {
    let falhas = 1;
    await page.route(/\/cases\/[0-9a-f]{32}\/exam$/, (route) => {
      if (falhas-- > 0) {
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ detail: "Não foi possível guardar esta série agora. Tente enviar de novo." }),
        });
      }
      return route.continue();
    });
    await abrirUpload(page);
    await escolher(page, MULTI);
    await lido(page);
    await serie(page, "ARTERIAL").locator('input[type="checkbox"]').check();
    await processar(page).click();
    await expect(page.locator("#state-done")).toBeVisible({ timeout: 40_000 });
    const falhou = page.locator('[data-testid="done-series"] li[data-state="fail"]');
    await expect(falhou).toContainText("Tente enviar de novo");
    await page.locator('[data-testid="retry-series-1"]').click();
    await expect(page.locator('[data-testid="done-series"] li[data-state="ok"]')).toHaveCount(2, { timeout: 20_000 });
  });
});
