// Exame de imagem no /case/: oferta, carga sob demanda, layouts, alinhamento
// com o 3D, contorno, mira, caso só com exame e celular.
//
// Fixtures geradas por mesh-processor/scripts/nrrd_to_stl.py --sphere:
//   exam-sphere.nrrd  64×56×48, eixos girados 12° em torno de x, origem fora de
//                     zero, esfera de raio 20 mm em (10, −30, 50) LPS (valor 1000)
//   exam-sphere.glb   a mesma esfera como STL (LPS), passada pelo processor.py
// Tamanhos diferentes por eixo e o centro fora do meio do volume: um eixo
// trocado, um volume transposto ou um espelhamento LPS/RAS desloca a esfera
// em dezenas de mm e o teste de alinhamento falha.
//
// Planos da fixture (normal = eixo IJK mais alinhado): axial = k (48 cortes),
// coronal = j (56), sagital = i (64).
//
// exam-sphere-fase2.nrrd (mesmo script): a mesma esfera no mesmo espaço LPS,
// como outra série do exame — 64×56×24 (cortes de 4 mm), origem deslocada e
// valor 600. Serve para a troca de série: a mira tem de ficar no mesmo ponto
// em mm, com índices diferentes.
//
// exam-ct.nrrd (mesmo script): TC mínima em Hounsfield, 40×40×20 (ar −1000,
// corpo 40, vaso 300, osso 800), para os presets de janela.
//
// No "R2", cada série n é cases/{uid}.exam-{n}.json + .exam-{n}.nrrd.

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLB = path.join(__dirname, "fixtures/exam-sphere.glb");
const NRRD = path.join(__dirname, "fixtures/exam-sphere.nrrd");
const NRRD2 = path.join(__dirname, "fixtures/exam-sphere-fase2.nrrd");
const CT = path.join(__dirname, "fixtures/exam-ct.nrrd");
const UID = "exam-fixture-sphere";
const SPHERE_RADIUS = 20;

test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(60_000); });

// withModel / withExam: o que existe no "R2" para este uid. series2: o caso tem
// também a segunda série; series2Status: resposta do NRRD dela. ct: a série 0
// é a TC em Hounsfield no lugar da esfera.
async function open(page, { withModel = true, withExam = true, series2 = false, series2Status = 200, ct = false } = {}) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  const glb = await fs.readFile(GLB);
  const files = [ct
    ? { nrrd: await fs.readFile(CT), label: "TC ABDOME", shape: [40, 40, 20], spacing: [1, 1, 2] }
    : { nrrd: await fs.readFile(NRRD), label: "ARTERIAL 1.0", shape: [64, 56, 48], spacing: [1.2, 1.5, 2.0] }];
  if (series2) files.push({ nrrd: await fs.readFile(NRRD2), label: "FASE 2 <4 mm>", shape: [64, 56, 24], spacing: [1.2, 1.5, 4.0] });
  const examGets = [];
  await page.route(`**/cases/${UID}.glb`, (route) =>
    withModel
      ? route.fulfill({ status: 200, contentType: "model/gltf-binary", body: glb })
      : route.fulfill({ status: 404 }));
  await page.route(new RegExp(`/cases/${UID}\\.exam-\\d\\.(json|nrrd)$`), (route) => {
    const [, n, ext] = route.request().url().match(/exam-(\d)\.(json|nrrd)$/);
    const s = withExam ? files[Number(n)] : null;
    if (!s) return route.fulfill({ status: 404 });
    if (ext === "json") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1, label: s.label, images: s.shape[2],
          shape: s.shape, spacing: s.spacing, bytes: s.nrrd.length,
        }),
      });
    }
    if (route.request().method() === "GET") examGets.push(route.request().url());
    if (Number(n) === 1 && series2Status !== 200) return route.fulfill({ status: series2Status });
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "content-length": String(s.nrrd.length) },
      body: s.nrrd,
    });
  });
  await page.route(`https://api.sketchfab.com/v3/models/${UID}`, (route) => route.fulfill({ status: 404 }));
  await page.goto(`/case/?id=${UID}`);
  return { examGets };
}

const stage = (page) => page.locator(".vw-stage");
const examLoaded = (page) => page.waitForFunction(() => window.__exam?.isLoaded(), null, { timeout: 20_000 });

// ---- Sem exame: nada muda ------------------------------------------------------

test("caso sem exame: nenhum controle de exame aparece", async ({ page, isMobile }) => {
  await open(page, { withExam: false });
  await expect(page.locator("#structures-list li")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('[data-testid="exam-hint"]')).toBeHidden();
  await expect(page.locator('[data-testid="layout-switcher"]')).toBeHidden();
  await expect(page.locator('[data-testid="view-picker"]')).toBeHidden();
  await expect(page.locator('[data-testid="exam-toggle"]')).toBeHidden();
  await expect(page.locator(".panel-tabs")).toBeHidden();
  if (!isMobile) await expect(page.locator("#structures-panel .panel-title")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("data-layout", "3d");
});

// ---- Com modelo e exame ----------------------------------------------------------

test("caso com exame: oferece os cortes sem baixar o exame", async ({ page, isMobile }) => {
  const { examGets } = await open(page);
  await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".panel-tabs")).toBeVisible();
  if (isMobile) await expect(page.locator('[data-testid="view-picker"]')).toBeVisible();
  else await expect(page.locator('[data-testid="layout-switcher"]')).toBeVisible();
  await expect(stage(page)).toHaveAttribute("data-layout", "3d");
  expect(examGets).toHaveLength(0);
});

test("Ver cortes baixa o exame e divide o palco; o 3D se redimensiona", async ({ page, isMobile }) => {
  const { examGets } = await open(page);
  await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
  const before = await page.locator("#canvas").evaluate((c) => c.width);
  await page.locator('[data-testid="exam-open"]').click();
  await examLoaded(page);
  expect(examGets.length).toBe(1);

  const header = await page.evaluate(() => window.__exam.getHeader());
  expect(header.dims).toEqual([64, 56, 48]);
  expect(await page.evaluate(() => window.__exam.getAxes())).toEqual({ axial: 2, coronal: 1, sagittal: 0 });

  if (isMobile) {
    await expect(stage(page)).toHaveAttribute("data-layout", "single");
    await expect(page.locator('[data-testid="slice-axial"]')).toBeVisible();
  } else {
    await expect(stage(page)).toHaveAttribute("data-layout", "3d+1");
    await expect(page.locator('[data-testid="slice-axial"]')).toBeVisible();
    await expect(page.locator('[data-testid="slice-coronal"]')).toBeHidden();
    // O renderer acompanha a célula do 3D (ResizeObserver), sem evento de janela.
    await expect.poll(() => page.locator("#canvas").evaluate((c) => c.width)).toBeLessThan(before);
  }
  await expect(page.locator('[data-testid="slice-count-axial"]')).toHaveText("Corte 25 / 48");
});

test("alinhamento: a esfera do exame cai em cima da esfera do modelo", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="exam-open"]').click();
  await examLoaded(page);

  const r = await page.evaluate(() => {
    const c = window.__world.getMeshCentroid("Esfera");
    const w = [c.x, c.y, c.z];
    // Centro da esfera em IJK, como o script de fixture a colocou.
    const centerIjk = [(64 - 1) / 2 + 3, (56 - 1) / 2 - 2, (48 - 1) / 2 + 1];
    const e = window.__exam.ijkToWorld(...centerIjk);
    const dist = Math.hypot(e[0] - w[0], e[1] - w[1], e[2] - w[2]);
    return { dist, inside: window.__exam.sliceValueAtWorld(w) };
  });
  expect(r.dist).toBeLessThan(1);      // mm
  expect(r.inside).toBeGreaterThan(900);
});

test("contorno: a esfera cortada ao meio tem raio ~20 mm no corte axial", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="exam-open"]').click();
  await examLoaded(page);

  const radii = await page.evaluate(async () => {
    const ex = window.__exam;
    ex.setIndex("axial", 25); // k do centro da esfera ≈ 24,5
    await new Promise((r) => requestAnimationFrame(() => r()));
    const seg = ex.getContour("axial")[0];
    const c = window.__world.getMeshCentroid("Esfera");
    const l = ex.getLayouts().axial;
    const out = [];
    for (let t = 0; t < seg.points.length; t += 2) {
      const ijk = [0, 0, 0];
      ijk[l.axis] = 25;
      ijk[l.h] = seg.points[t];
      ijk[l.v] = seg.points[t + 1];
      const w = ex.ijkToWorld(...ijk);
      out.push(Math.hypot(w[0] - c.x, w[1] - c.y, w[2] - c.z));
    }
    return out;
  });
  expect(radii.length).toBeGreaterThan(20);
  radii.sort((a, b) => a - b);
  const median = radii[Math.floor(radii.length / 2)];
  expect(median).toBeGreaterThan(SPHERE_RADIUS - 1);
  expect(median).toBeLessThan(SPHERE_RADIUS + 1);
  await expect(page.locator('[data-testid="slice-axial"] .sv-contour')).toHaveCount(1);
});

test("régua do corte e mira ligada entre as vistas", async ({ page, isMobile }) => {
  test.skip(isMobile, "Quadrantes com mira: desktop (o celular abre um corte por toque).");
  await open(page);
  await expect(page.locator('[data-testid="layout-switcher"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="layout-quad"]').click();
  await examLoaded(page);
  await expect(stage(page)).toHaveAttribute("data-layout", "quad");
  for (const p of ["axial", "coronal", "sagittal"]) {
    await expect(page.locator(`[data-testid="slice-${p}"]`)).toBeVisible();
  }

  await page.locator('[data-testid="slice-slider-axial"]').fill("10");
  await expect(page.locator('[data-testid="slice-count-axial"]')).toHaveText("Corte 10 / 48");
  await expect(page.locator('[data-testid="plane-count-axial"]')).toHaveText("10/48");

  // Clique no canto superior esquerdo da imagem coronal → os outros dois
  // planos (axial e sagital) mudam de corte.
  const before = await page.evaluate(() => window.__exam.getIndices());
  const body = page.locator('[data-testid="slice-coronal"] .sv-body');
  const rect = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="slice-coronal"] .sv-body').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  await body.click({ position: { x: rect.w * 0.35, y: rect.h * 0.3 } });
  const after = await page.evaluate(() => window.__exam.getIndices());
  expect(after.coronal).toBe(before.coronal);
  expect(after.axial).not.toBe(before.axial);
  expect(after.sagittal).not.toBe(before.sagittal);
});

test("Cortar volta o palco para só o 3D e devolve o layout na saída", async ({ page, isMobile }) => {
  test.skip(isMobile, "No celular Cortar troca a barra; o layout é o mesmo mecanismo.");
  await open(page);
  await expect(page.locator('[data-testid="layout-switcher"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="layout-3d3"]').click();
  await examLoaded(page);
  await expect(stage(page)).toHaveAttribute("data-layout", "3d+3");

  await page.locator('[data-testid="contour-button"]').click();
  await expect(stage(page)).toHaveAttribute("data-layout", "3d");
  await page.locator('[data-testid="contour-button"]').click();
  await expect(stage(page)).toHaveAttribute("data-layout", "3d+3");
});

test("aba Exame: olho do plano e brilho", async ({ page, isMobile }) => {
  await open(page);
  await expect(page.locator(".panel-tabs")).toBeVisible({ timeout: 15_000 });
  if (isMobile) await page.locator('[data-testid="exam-toggle"]').click();
  else await page.locator('[data-testid="exam-tab"]').click();
  await examLoaded(page);
  await expect(page.locator('[data-testid="exam-tab"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".exam-anon")).toBeVisible();

  const eye = page.locator('[data-testid="plane-eye-coronal"]');
  await expect(eye).toHaveAttribute("data-visible", "false");
  await eye.click();
  await expect(eye).toHaveAttribute("data-visible", "true");

  const w0 = await page.evaluate(() => window.__exam.getWindow());
  await page.locator('[data-testid="exam-brightness"]').fill("80");
  const w1 = await page.evaluate(() => window.__exam.getWindow());
  expect(w1.lo).toBeLessThan(w0.lo); // mais brilho = janela desce
  await page.locator('[data-testid="exam-auto"]').click();
  expect(await page.evaluate(() => window.__exam.getWindow())).toEqual(w0);
});

// ---- Só exame ----------------------------------------------------------------------

test("caso só com exame: abre direto nos cortes, sem Medir nem Cortar", async ({ page, isMobile }) => {
  await open(page, { withModel: false });
  await examLoaded(page);
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#error")).toBeHidden();
  await expect(stage(page)).toHaveAttribute("data-layout", isMobile ? "single" : "quad");
  await expect(page.locator('[data-testid="structures-tab"]')).toBeHidden();
  await expect(page.locator('[data-testid="measure-fab"]')).toBeHidden();
  await expect(page.locator('[data-testid="contour-button"]')).toBeHidden();
  if (isMobile) await expect(page.locator('[data-testid="exam-toggle"]')).toBeVisible();
  // Os três planos no 3D (é o único conteúdo da cena).
  for (const p of ["axial", "coronal", "sagittal"]) {
    await expect(page.locator(`[data-testid="plane-eye-${p}"]`)).toHaveAttribute("data-visible", "true");
  }
});

// ---- Celular -------------------------------------------------------------------------

test("celular: seletor de vistas → quadrantes → tocar abre o corte", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Seletor de vistas só existe no celular.");
  await open(page);
  await expect(page.locator('[data-testid="view-picker"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="view-picker"]').click();
  await expect(page.locator('[data-testid="view-sheet"]')).toBeVisible();
  await page.locator('[data-testid="view-sheet"] [data-layout="quad"]').click();
  await examLoaded(page);
  await expect(stage(page)).toHaveAttribute("data-layout", "quad");
  await expect(page.locator('[data-testid="view-picker"] .view-picker-name')).toHaveText("Quadrantes");

  await page.locator('[data-testid="slice-sagittal"] .sv-body').click();
  await expect(stage(page)).toHaveAttribute("data-layout", "single");
  await expect(page.locator('[data-testid="slice-sagittal"]')).toBeVisible();
  await expect(page.locator('[data-testid="slice-axial"]')).toBeHidden();
  await expect(page.locator('[data-testid="view-tabs"] [data-view="sagittal"]')).toHaveAttribute("aria-selected", "true");
});

test("celular: Exame e Estruturas dividem a mesma gaveta", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Gaveta só no celular.");
  await open(page);
  const exam = page.locator('[data-testid="exam-toggle"]');
  const structures = page.locator('[data-testid="sheet-toggle"]');
  await expect(exam).toBeVisible({ timeout: 15_000 });
  await expect(structures).toHaveAttribute("aria-pressed", "true");

  await exam.click();
  await expect(exam).toHaveAttribute("aria-pressed", "true");
  await expect(structures).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#exam-panel")).toBeVisible();

  await exam.click();
  await expect(page.locator("#structures-panel")).toBeHidden();
  await expect(exam).toHaveAttribute("aria-pressed", "false");
});

// ---- Várias séries ------------------------------------------------------------------

// Centro da esfera em IJK na série 0 (o script de fixture a colocou ali).
const SPHERE_IJK = [(64 - 1) / 2 + 3, (56 - 1) / 2 - 2, (48 - 1) / 2 + 1];

async function openAndLoad(page, opts) {
  const r = await open(page, opts);
  if (opts?.withModel === false) {
    await examLoaded(page);
  } else {
    await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="exam-open"]').click();
    await examLoaded(page);
  }
  return r;
}

test("uma série só: sem seletor de série", async ({ page }) => {
  await openAndLoad(page);
  await expect(page.locator('[data-testid="exam-series-0"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__exam.getSeries())).toHaveLength(1);
});

test("duas séries: só a primeira baixa; o painel diz quantas são", async ({ page }) => {
  const { examGets } = await open(page, { series2: true });
  await expect(page.locator('[data-testid="exam-hint"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="exam-pending-sub"]')).toContainText("2 séries");
  await page.locator('[data-testid="exam-open"]').click();
  await examLoaded(page);
  expect(examGets).toHaveLength(1);
  expect(examGets[0]).toMatch(/exam-0\.nrrd$/);
  await expect(page.locator('[data-testid="exam-series-0"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="exam-series-0"]')).toContainText("usada na segmentação");
  // O nome vem do DICOM: texto, nunca HTML.
  await expect(page.locator('[data-testid="exam-series-1"] .exam-series-label')).toHaveText("FASE 2 <4 mm>");
  await expect(page.locator('[data-testid="exam-series-note"]')).toHaveCount(0);
});

test("trocar de série mantém a mira no mesmo ponto em mm e mostra a nota", async ({ page, isMobile }) => {
  const { examGets } = await openAndLoad(page, { series2: true });
  const before = await page.evaluate((c) => {
    const [i, j, k] = c;
    window.__exam.setIndex("sagittal", i);
    window.__exam.setIndex("coronal", j);
    window.__exam.setIndex("axial", k);
    return window.__exam.crossWorld();
  }, SPHERE_IJK);

  if (isMobile) {
    expect(await page.evaluate(() => window.__exam.selectSeries(1))).toBe(true);
  } else {
    await page.evaluate(() => window.__exam.setTab("exam"));
    await page.locator('[data-testid="exam-series-1"]').click();
    await expect(page.locator('[data-testid="exam-series-1"]')).toHaveAttribute("aria-pressed", "true");
  }
  await expect.poll(() => page.evaluate(() => window.__exam.getHeader().dims)).toEqual([64, 56, 24]);
  expect(examGets).toHaveLength(2);

  const after = await page.evaluate(() => window.__exam.crossWorld());
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  expect(moved).toBeLessThan(4); // no máximo um corte da série de 4 mm
  // A imagem na tela é a da série nova (esfera com valor 600).
  const v = await page.evaluate((w) => window.__exam.sliceValueAtWorld(w), after);
  expect(v).toBeGreaterThan(450);
  expect(v).toBeLessThan(700);
  await expect(page.locator('[data-testid="exam-series-note"]')).toContainText("ARTERIAL 1.0");

  // Voltar é imediato: a série 0 continua guardada.
  expect(await page.evaluate(() => window.__exam.selectSeries(0))).toBe(true);
  expect(examGets).toHaveLength(2);
  await expect(page.locator('[data-testid="exam-series-note"]')).toHaveCount(0);
});

test("série que não baixa: mensagem, e a série atual continua", async ({ page }) => {
  await openAndLoad(page, { series2: true, series2Status: 404 });
  expect(await page.evaluate(() => window.__exam.selectSeries(1))).toBe(false);
  await expect(page.locator('[data-testid="exam-series-status"]')).toContainText("Não foi possível baixar esta série");
  expect(await page.evaluate(() => window.__exam.getHeader().dims)).toEqual([64, 56, 48]);
  expect((await page.evaluate(() => window.__exam.getSeries()))[0].current).toBe(true);
});

test("caso só com exame e duas séries: sem marca de segmentação nem nota", async ({ page }) => {
  await openAndLoad(page, { withModel: false, series2: true });
  await expect(page.locator('[data-testid="exam-series-0"]')).not.toContainText("segmentação");
  expect(await page.evaluate(() => window.__exam.selectSeries(1))).toBe(true);
  await expect(page.locator('[data-testid="exam-series-note"]')).toHaveCount(0);
});

// ---- Janela: presets de TC e janela/nível editáveis -------------------------------------

test("TC abre em Partes moles; presets e janela/nível digitados mudam a imagem", async ({ page, isMobile }) => {
  await open(page, { withModel: false, ct: true });
  await examLoaded(page);
  expect(await page.evaluate(() => window.__exam.isCT())).toBe(true);
  expect(await page.evaluate(() => window.__exam.getPreset())).toBe("soft");
  expect(await page.evaluate(() => window.__exam.getWindow())).toEqual({ lo: -160, hi: 240 });
  await expect(page.locator('[data-testid="exam-width"]')).toHaveValue("400");
  await expect(page.locator('[data-testid="exam-level"]')).toHaveValue("40");
  await expect(page.locator('[data-testid="exam-preset-soft"]')).toHaveAttribute("aria-pressed", "true");
  // O pixel de ar fica preto e o de osso branco em Partes moles.
  const air = await page.evaluate(() => window.__exam.sliceValueAtWorld(window.__exam.ijkToWorld(1, 1, 10)));
  expect(air).toBe(-1000);

  test.skip(isMobile, "no celular o painel fica na gaveta; os ganchos acima já cobrem a lógica");
  await page.locator('[data-testid="exam-preset-bone"]').click();
  expect(await page.evaluate(() => window.__exam.getWindow())).toEqual({ lo: -500, hi: 1300 });
  await expect(page.locator('[data-testid="exam-width"]')).toHaveValue("1800");
  await expect(page.locator('[data-testid="exam-level"]')).toHaveValue("400");

  await page.locator('[data-testid="exam-width"]').fill("350");
  await page.locator('[data-testid="exam-level"]').fill("50");
  await page.locator('[data-testid="exam-level"]').press("Enter");
  await expect.poll(() => page.evaluate(() => window.__exam.getPreset())).toBe("custom");
  expect(await page.evaluate(() => window.__exam.getWindow())).toEqual({ lo: -125, hi: 225 });
  await expect(page.locator('.exam-preset[aria-pressed="true"]')).toHaveCount(0);

  // Brilho ajusta a partir da janela digitada, e os números acompanham.
  await page.locator('[data-testid="exam-brightness"]').fill("75");
  await expect(page.locator('[data-testid="exam-level"]')).not.toHaveValue("50");
  await expect(page.locator('[data-testid="exam-width"]')).toHaveValue("350");

  // Janela inválida volta ao que estava.
  await page.locator('[data-testid="exam-width"]').fill("0");
  await page.locator('[data-testid="exam-width"]').press("Enter");
  await expect(page.locator('[data-testid="exam-width"]')).toHaveValue("350");
});

test("fora da TC não há presets; Auto e janela/nível continuam", async ({ page }) => {
  await openAndLoad(page);
  expect(await page.evaluate(() => window.__exam.isCT())).toBe(false);
  expect(await page.evaluate(() => window.__exam.getPreset())).toBe("auto");
  await expect(page.locator('[data-testid="exam-preset-soft"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="exam-auto"]')).toHaveCount(1);
  const w = await page.evaluate(() => window.__exam.getWindow());
  await expect(page.locator('[data-testid="exam-width"]')).toHaveValue(String(Math.round(w.hi - w.lo)));
});
