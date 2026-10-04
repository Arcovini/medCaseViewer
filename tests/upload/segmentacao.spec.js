/* Segmentação em NRRD: o caso inteiro só com NRRDs. A página separa o .nrrd
 * que é segmentação (vira estruturas, campo `files`; o mesh-processor gera o
 * 3D) do que é o volume de imagem (vira exame, campo `exam`).
 *
 * Os testes "com o backend" precisam do mesh-processor local em DRY_RUN na
 * porta 8000 com DRY_RUN_GLB_DIR apontando para a raiz deste repo (o que ele
 * "sobe" aparece em /cases/, servido pelo mesmo servidor do Playwright), e se
 * pulam sem ele.
 *
 * Fixtures (mesh-processor/scripts/nrrd_to_stl.py --seg e --sphere), em
 * ../case-next/fixtures:
 *   exam-sphere.nrrd      o volume: esfera de 20 mm, eixos oblíquos
 *   exam-sphere.seg.nrrd  a segmentação dela no formato do 3D Slicer:
 *                         "Esfera" (1) e "Núcleo" (2, nome em UTF-8)
 *   esfera-rotulos.nrrd   o mesmo labelmap sem cabeçalho de segmentos nem nome
 *                         que diga "segmentação" — reconhecido pelos valores
 *   exam-ct.nrrd          TC em Hounsfield (4 valores, negativos): é exame
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cf = (n) => path.join(__dirname, "../case-next/fixtures", n);
const IMAGEM = cf("exam-sphere.nrrd");
const SEG = cf("exam-sphere.seg.nrrd");
const ROTULOS = cf("esfera-rotulos.nrrd");
const TC = cf("exam-ct.nrrd");
const RIM = path.join(__dirname, "fixtures", "Rim.stl");

const BACKEND = "http://localhost:8000";
const COMO_SUBIR =
  "backend ausente: DRY_RUN=true DRY_RUN_GLB_DIR=<este repo> uvicorn main:app --port 8000 no repo mesh-processor";

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
const pecas = (page) => page.evaluate(() => window.__upload.getPieces());
const lido = (page) => page.waitForFunction(() => !window.__upload.isReading());

test.describe("separar segmentação de exame (sem rede)", () => {
  test("segmentação do Slicer + volume: estruturas com os nomes dos segmentos, e o exame", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [SEG, IMAGEM]);
    await expect(page.locator('#structure-list .up-row[data-segment="true"]')).toHaveCount(2);
    expect(await pecas(page)).toEqual([
      { name: "exam-sphere", segFile: true, segment: false },
      { name: "Esfera", segFile: false, segment: true },
      { name: "Nucleo", segFile: false, segment: true },
    ]);
    await expect(page.locator('#structure-list .up-row[data-segmentation="true"]'))
      .toContainText("segmentação · 2 estruturas");
    await expect(resumo(page)).toHaveText(/^exam-sphere · NRRD · 48 imagens/);
    expect(await page.evaluate(() => window.__upload.getStructures())).toEqual(["exam-sphere.seg.nrrd"]);
    await expect(processar(page)).toBeEnabled();
    // Segmentação não oferece "Isolar parte" (o backend só divide STLs).
    await expect(page.getByRole("button", { name: /^Isolar uma parte/ })).toHaveCount(0);
  });

  test("labelmap sem cabeçalho nem nome: reconhecido pelos valores", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, ROTULOS);
    await expect(page.locator('#structure-list .up-row[data-segment="true"]')).toHaveCount(2);
    expect((await pecas(page)).map((p) => p.name)).toEqual(["esfera-rotulos", "Segmento 1", "Segmento 2"]);
    await expect(resumo(page)).toBeHidden();
  });

  test("volume de imagem continua exame: tons contínuos e TC com negativos", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, IMAGEM);
    await lido(page);
    await escolher(page, TC);
    await lido(page);
    await expect(page.locator('[data-testid="exam-count"]')).toHaveText("2 séries");
    expect(await page.evaluate(() => window.__upload.getStructures())).toEqual([]);
  });

  test("segmentação e STL juntos: as duas viram estruturas", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, SEG]);
    await expect(page.locator('#structure-list .up-row[data-segment="true"]')).toHaveCount(2);
    expect((await pecas(page)).map((p) => p.name)).toEqual(["Rim", "exam-sphere", "Esfera", "Nucleo"]);
    // Com um arquivo que não é STL, isolar fica de fora (o backend recusaria).
    await expect(page.getByRole("button", { name: /^Isolar uma parte/ })).toHaveCount(0);
  });
});

test.describe("com o backend", () => {
  test.beforeEach(() => test.skip(!backendUp, COMO_SUBIR));

  test("só NRRDs: o caso abre com o 3D da segmentação e os cortes do volume, alinhados", async ({ page }) => {
    test.setTimeout(120_000);
    const posts = [];
    page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
    await abrirUpload(page);
    await escolher(page, [SEG, IMAGEM]);
    await expect(resumo(page)).toBeVisible();
    await processar(page).click();
    await expect(page.locator("#state-done")).toBeVisible({ timeout: 30_000 });
    expect(posts.filter((u) => u.endsWith("/upload"))).toHaveLength(1);
    const url = await page.locator("#viewer-url").inputValue();
    const uid = url.match(/id=([0-9a-f]{32})/)[1];

    await page.addInitScript(() => { window.__playwrightTest = true; }); // ganchos __exam/__world
    await page.goto(`/case/?id=${uid}`);
    await expect(page.locator("#structures-list li")).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator("#structures-list")).toContainText("Esfera");
    await expect(page.locator("#structures-list")).toContainText("Nucleo");
    await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="exam-open"]').click();
    await page.waitForFunction(() => window.__exam?.isLoaded(), null, { timeout: 40_000 });

    const r = await page.evaluate(() => {
      const c = window.__world.getMeshCentroid("Esfera");
      const w = [c.x, c.y, c.z];
      const centerIjk = [(64 - 1) / 2 + 3, (56 - 1) / 2 - 2, (48 - 1) / 2 + 1];
      const e = window.__exam.ijkToWorld(...centerIjk);
      return { dist: Math.hypot(e[0] - w[0], e[1] - w[1], e[2] - w[2]), inside: window.__exam.sliceValueAtWorld(w) };
    });
    expect(r.dist).toBeLessThan(1); // mm
    expect(r.inside).toBeGreaterThan(900);
  });
});
