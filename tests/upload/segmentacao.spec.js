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
const FASE2 = cf("exam-sphere-fase2.nrrd");
const uf = (n) => path.join(__dirname, "fixtures", n);
const RIM = uf("Rim.stl");
// Par real do Slicer (fixtures/slicer/LEIAME.md) e a série DICOM oblíqua com a
// máscara na grade que o backend lê dela (mesh-processor/scripts/upload_fixtures.py
// --pareamento).
const SLICER_TC = uf("slicer/CTChest4.nrrd");
const SLICER_SEG = uf("slicer/Segmentation.seg.nrrd");
const OBLIQUA = Array.from({ length: 12 }, (_, k) => uf(`obliqua/IM${String(k + 1).padStart(4, "0")}`));
const OBLIQUA_ROTULOS = uf("obliqua-rotulos.nrrd");
const OBLIQUA_RECORTE = uf("obliqua-recorte.seg.nrrd");

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

// Segmentação de uma aquisição, exame de outra: o 3D não cai nos cortes. A
// página compara onde a segmentação foi desenhada com a série principal.
test.describe("segmentação × série do exame", () => {
  const pareamento = (page) => page.evaluate(() => window.__upload.getPairing());
  const aviso = (page) => page.locator('[data-testid="exam-pairing"]');
  const enviar = async (page, files) => { await escolher(page, files); await lido(page); };

  test("par real do Slicer: desenhada nesta série, sem aviso", async ({ page }) => {
    await abrirUpload(page);
    await enviar(page, [SLICER_SEG, SLICER_TC]);
    expect(await pareamento(page)).toEqual([{ file: "Segmentation.seg.nrrd", verdict: "same" }]);
    await expect(aviso(page)).toBeHidden();
  });

  test("DICOM oblíquo: a página lê a série como o backend (labelmap e recorte do Slicer)", async ({ page }) => {
    await abrirUpload(page);
    await enviar(page, [...OBLIQUA, OBLIQUA_ROTULOS, OBLIQUA_RECORTE]);
    expect(await pareamento(page)).toEqual([
      { file: "obliqua-rotulos.nrrd", verdict: "same" },
      // Grade própria menor; vale a do volume em que foi desenhada.
      { file: "obliqua-recorte.seg.nrrd", verdict: "same" },
    ]);
    await expect(aviso(page)).toBeHidden();
  });

  test("outra série no mesmo espaço (outra fase): avisa que pode não coincidir", async ({ page }) => {
    await abrirUpload(page);
    await enviar(page, [SEG, FASE2]);
    expect(await pareamento(page)).toEqual([{ file: "exam-sphere.seg.nrrd", verdict: "other" }]);
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText("não foi desenhada na série exam-sphere-fase2");
  });

  test("segmentação fora do exame: avisa que o 3D não aparece nos cortes", async ({ page }) => {
    await abrirUpload(page);
    await enviar(page, [SLICER_SEG, IMAGEM]);
    expect(await pareamento(page)).toEqual([{ file: "Segmentation.seg.nrrd", verdict: "outside" }]);
    await expect(aviso(page)).toContainText("fica fora da série exam-sphere");
    // Aviso, não bloqueio: o caso ainda pode ser enviado.
    await expect(processar(page)).toBeEnabled();
  });

  test("com várias séries, a principal vira a que a segmentação usou", async ({ page }) => {
    await abrirUpload(page);
    // Pela regra de sempre (cortes mais finos) a sugerida seria exam-sphere.
    await enviar(page, [IMAGEM, SLICER_TC]);
    expect((await page.evaluate(() => window.__upload.getExam())).primary).toBe("nrrd:exam-sphere.nrrd");
    // A segmentação chega depois e diz em qual foi desenhada.
    await enviar(page, SLICER_SEG);
    expect((await page.evaluate(() => window.__upload.getExam())).primary).toBe("nrrd:CTChest4.nrrd");
    expect(await pareamento(page)).toEqual([{ file: "Segmentation.seg.nrrd", verdict: "same" }]);
    await expect(aviso(page)).toBeHidden();
  });

  test("marcar outra série como a da segmentação acende o aviso; voltar apaga", async ({ page }) => {
    await abrirUpload(page);
    await enviar(page, [SEG, IMAGEM, FASE2]);
    await expect(aviso(page)).toBeHidden();
    const { series } = await page.evaluate(() => window.__upload.getExam());
    const fase2 = series.findIndex((s) => s.key === "nrrd:exam-sphere-fase2.nrrd");
    const certa = series.findIndex((s) => s.key === "nrrd:exam-sphere.nrrd");
    await page.locator(`[data-testid="series-check-${fase2}"]`).check();
    await page.locator(`[data-testid="series-make-primary-${fase2}"]`).click();
    await expect(aviso(page)).toBeVisible();
    await page.locator(`[data-testid="series-make-primary-${certa}"]`).click();
    await expect(aviso(page)).toBeHidden();
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
