// @ts-check
// Cortar: barra de ferramentas à esquerda (Medir + Cortar), desenhar um
// contorno sobre o modelo, escolher as estruturas cruzadas, cortar e desfazer.
// O corte precisa deixar a malha FECHADA (watertight) — conferimos pelo
// volume/manifold de world.computeMeshVolumeCached via window.__world.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");
const TEST_UID = "test-fixture-abc123";
const VIEWER_URL = `/case/?id=${TEST_UID}`;
// O primeiro corte baixa o motor de corte (WASM) do CDN.
const CUT_TIMEOUT = 30_000;

// No projeto "desktop" (WebGL por software) cada clique espera quadros de
// vários segundos; com a suíte inteira em paralelo, um fluxo de corte com
// ~20 passos passava dos 45 s do padrão sem nenhum passo falhar.
test.describe.configure({ timeout: 120_000 });

async function setup(page) {
  const body = await fs.readFile(FIXTURE_PATH);
  await page.route(`**/cases/${TEST_UID}.glb`, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body }),
  );
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await page.goto(VIEWER_URL);
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  await expect(page.locator('[data-testid="tool-rail"]')).toBeVisible();
}

// Traço do arraste como PointerEvents disparados no canvas, numa só ida à
// página. No projeto "desktop" (WebGL por software) cada page.mouse.move leva
// ~1 s esperando o render loop, e um contorno de 36 pontos estourava os 45 s.
// O caminho no contour.js é o mesmo: pointerdown → pointermove… → pointerup.
async function drawPath(page, points) {
  await page.evaluate((pts) => {
    const canvas = document.getElementById("canvas");
    const fire = (type, [x, y]) => canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true,
    }));
    fire("pointerdown", pts[0]);
    for (const p of pts.slice(1)) fire("pointermove", p);
    fire("pointerup", pts[pts.length - 1]);
  }, points);
}

async function canvasCenter(page) {
  const box = await page.locator("#canvas").boundingBox();
  if (!box) throw new Error("canvas sem layout");
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

// Elipse ao redor do centro do canvas (onde frameToScene põe o modelo).
async function drawContour(page, { rx = 110, ry = 90, dx = 0, dy = 0 } = {}) {
  const { cx, cy } = await canvasCenter(page);
  const steps = 36;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + dx + rx * Math.cos(a), cy + dy + ry * Math.sin(a)]);
  }
  await drawPath(page, pts);
}

// Volume e "fechada" de cada estrutura.
function volumes(page) {
  return page.evaluate(() => Object.fromEntries(
    window.__world.getMeshNames().map((n) => [n, window.__world.computeMeshVolumeCached(n)]),
  ));
}

async function cut(page) {
  await page.locator('[data-testid="contour-apply"]').click();
  await expect(page.locator('[data-testid="contour-toast"]')).toContainText("Corte aplicado", { timeout: CUT_TIMEOUT });
}

test("barra: Medir e Cortar; o menu de Medir abre junto da barra", async ({ page, isMobile }) => {
  await setup(page);
  const rail = page.locator('[data-testid="tool-rail"]');
  await expect(rail.locator('[data-testid="measure-fab"]')).toContainText("Medir");
  await expect(rail.locator('[data-testid="contour-button"]')).toContainText("Cortar");
  // Desfazer só depois do primeiro corte; Restaurar não existe mais.
  await expect(page.locator('[data-testid="cut-undo"]')).toBeHidden();
  await expect(page.locator('[data-testid="cut-restore"]')).toHaveCount(0);
  // Estruturas na barra e a barra do modo só existem no celular.
  if (!isMobile) await expect(page.locator('[data-testid="sheet-toggle"]')).toBeHidden();

  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "true");
  const railBox = await rail.boundingBox();
  const menuBox = await page.locator(".measure-menu").boundingBox();
  if (isMobile) {
    // Celular: folha acima do rodapé.
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(railBox.y + 1);
  } else {
    // Desktop: ao lado da barra da esquerda.
    expect(menuBox.x).toBeGreaterThan(railBox.x + railBox.width);
  }
});

test("celular: rodapé com Estruturas, Medir e Cortar; Cortar troca pela barra do modo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "O rodapé só existe no celular.");
  await setup(page);
  const rail = page.locator('[data-testid="tool-rail"]');
  const panel = page.locator("#structures-panel");
  const toggle = page.locator('[data-testid="sheet-toggle"]');

  const railBox = await rail.boundingBox();
  const vp = page.viewportSize();
  expect(railBox.y + railBox.height).toBeGreaterThan(vp.height - 2);   // colada no rodapé
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toBeVisible();   // o caso abre com a gaveta aberta, como antes

  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(panel).toBeVisible();

  await page.locator('[data-testid="contour-button"]').click();
  await expect(page.locator('[data-testid="mode-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="mode-undo"]')).toBeDisabled();
  await expect(rail).toBeHidden();
  await expect(panel).toBeHidden();

  await page.locator('[data-testid="mode-cancel"]').click();
  await expect(page.locator('[data-testid="mode-bar"]')).toBeHidden();
  await expect(rail).toBeVisible();
  await expect(panel).toBeVisible();   // volta como estava antes do modo
});

test("celular: dedo desenha com lupa; segundo dedo descarta o traço para navegar", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Navegação por toque só em aparelho de toque.");
  await setup(page);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(!coarse, "O navegador emulado não se apresenta como tela de toque (pointer: coarse).");
  await page.locator('[data-testid="contour-button"]').click();
  const { cx, cy } = await canvasCenter(page);

  // Um dedo desenhando: a lupa aparece acima dele.
  await page.evaluate(({ cx, cy }) => {
    const c = document.getElementById("canvas");
    const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: id, pointerType: "touch", isPrimary: id === 11, bubbles: true,
    }));
    fire("pointerdown", 11, cx + 100, cy);
    for (let i = 1; i <= 12; i++) {
      const a = (i / 36) * Math.PI * 2;
      fire("pointermove", 11, cx + 100 * Math.cos(a), cy + 90 * Math.sin(a));
    }
  }, { cx, cy });
  await expect(page.locator('[data-testid="measure-loupe"]')).toHaveAttribute("data-visible", "true");
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("Solte para fechar");

  // Segundo dedo: o traço sai, a lupa some e o modo continua ligado.
  await page.evaluate(({ cx, cy }) => {
    const c = document.getElementById("canvas");
    const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: id, pointerType: "touch", isPrimary: false, bubbles: true,
    }));
    fire("pointerdown", 12, cx - 60, cy + 40);
    fire("pointerup", 12, cx - 60, cy + 40);
    fire("pointerup", 11, cx, cy);
  }, { cx, cy });
  await expect(page.locator('[data-testid="measure-loupe"]')).toHaveAttribute("data-visible", "false");
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("Contorne a região");
  await expect(page.locator('[data-testid="contour-card"]')).toBeHidden();
  await expect(page.locator('[data-testid="contour-button"]')).toHaveAttribute("aria-pressed", "true");

  // Depois de soltar os dois dedos, um dedo volta a desenhar normalmente.
  await drawContour(page);
  await expect(page.locator('[data-testid="contour-card"]')).toBeVisible();
});

test("cortar: desenhar, escolher, cortar (malha fechada) e desfazer", async ({ page, isMobile }) => {
  await setup(page);
  const before = await volumes(page);

  const btn = page.locator('[data-testid="contour-button"]');
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("Contorne a região");
  // Medir fica travado enquanto Cortar está ativo.
  await expect(page.locator('[data-testid="measure-fab"]')).toBeDisabled();

  await drawContour(page);
  const card = page.locator('[data-testid="contour-card"]');
  await expect(card).toBeVisible();
  expect(await card.locator(".contour-check").count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("O corte remove a parte de");

  await cut(page);
  // Ponteiro sobre o aviso: ele não some enquanto as conferências abaixo rodam
  // (o prazo de 8 s é curto para o Chrome com WebGL por software).
  await page.locator('[data-testid="contour-toast"]').hover();
  await expect(card).toBeHidden();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  if (isMobile) {
    // Celular: o rodapé volta e a gaveta fica fechada, para o corte ser visto.
    await expect(page.locator('[data-testid="mode-bar"]')).toBeHidden();
    await expect(page.locator('[data-testid="tool-rail"]')).toBeVisible();
    await expect(page.locator("#structures-panel")).toBeHidden();
  } else {
    await expect(page.locator('[data-testid="cut-undo"]')).toBeVisible();
  }

  const after = await volumes(page);
  const changed = Object.keys(before).filter((n) => after[n].volumeCm3 !== before[n].volumeCm3);
  expect(changed.length).toBeGreaterThan(0);
  for (const n of changed) {
    // A parte que sobrou é menor e continua fechada: a abertura foi tampada.
    expect(after[n].volumeCm3).toBeLessThan(before[n].volumeCm3);
    expect(after[n].manifold).toBe(true);
  }
  expect(await page.locator(".structure-cut-note:not([hidden])").count()).toBe(changed.length);

  await page.locator('[data-testid="contour-toast-undo"]').click();
  expect(await volumes(page)).toEqual(before);
  await expect(page.locator('[data-testid="cut-undo"]')).toBeHidden();
  expect(await page.locator(".structure-cut-note:not([hidden])").count()).toBe(0);
});

test("cortar: estrutura desmarcada fica intacta; sem nenhuma marcada, Cortar trava", async ({ page }) => {
  await setup(page);
  await page.locator('[data-testid="contour-button"]').click();
  await drawContour(page);

  const candidates = await page.evaluate(() => window.__contour.getCandidates());
  expect(candidates.length).toBeGreaterThan(0);
  const kept = candidates[0].name;
  const keptBefore = (await volumes(page))[kept];

  const checks = page.locator('[data-testid="contour-card"] input[type=checkbox]');
  const n = await checks.count();
  for (let i = 0; i < n; i++) await checks.nth(i).uncheck();
  await expect(page.locator('[data-testid="contour-apply"]')).toBeDisabled();
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("Marque ao menos uma estrutura");

  if (n > 1) {
    // Remarca todas menos a primeira: ela precisa sair ilesa.
    for (let i = 1; i < n; i++) await checks.nth(i).check();
    await cut(page);
    expect((await volumes(page))[kept]).toEqual(keptBefore);
  }
});

test("cortar: Cancelar e Esc saem sem mexer no modelo", async ({ page }) => {
  await setup(page);
  const before = await volumes(page);
  const btn = page.locator('[data-testid="contour-button"]');

  await btn.click();
  await drawContour(page);
  await expect(page.locator('[data-testid="contour-card"]')).toBeVisible();
  await page.locator('[data-testid="contour-cancel"]').click();
  await expect(page.locator('[data-testid="contour-card"]')).toBeHidden();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  expect(await volumes(page)).toEqual(before);

  await btn.click();
  await page.keyboard.press("Escape");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-testid="measure-hint"]')).toBeHidden();
  expect(await volumes(page)).toEqual(before);
});

test("cortar: clique sem arrastar pede um contorno maior; traço em oito é recusado", async ({ page }) => {
  await setup(page);
  await page.locator('[data-testid="contour-button"]').click();
  const { cx, cy } = await canvasCenter(page);
  await drawPath(page, [[cx, cy], [cx, cy]]);
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("pequeno demais");

  // Lemniscata: cruza no meio, longe das pontas — não é "passar do começo".
  const eight = [];
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    const k = 1 + Math.sin(t) ** 2;
    eight.push([cx + (120 * Math.cos(t)) / k, cy + (120 * Math.sin(t) * Math.cos(t)) / k]);
  }
  await drawPath(page, eight);
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText("se cruzou");
  await expect(page.locator('[data-testid="contour-card"]')).toBeHidden();
});

// Desfazer o último corte: no desktop pela barra da esquerda; no celular pela
// barra do modo (entra em Cortar, desfaz, sai).
async function undoOnce(page, isMobile) {
  if (!isMobile) {
    await page.locator('[data-testid="cut-undo"]').click();
    return;
  }
  await page.locator('[data-testid="contour-button"]').click();
  await page.locator('[data-testid="mode-undo"]').click();
  await page.locator('[data-testid="mode-cancel"]').click();
}

test("cortar: dois cortes (dentro e fora) ficam fechados; desfazer duas vezes volta ao modelo completo", async ({ page, isMobile }) => {
  await setup(page);
  const before = await volumes(page);
  const btn = page.locator('[data-testid="contour-button"]');

  await btn.click();
  await drawContour(page, { rx: 70, ry: 70, dx: -40 });
  await cut(page);

  await btn.click();
  await drawContour(page, { rx: 70, ry: 70, dx: 60, dy: 20 });
  await page.locator('[data-testid="contour-side-outside"]').click();
  await cut(page);

  const after = await volumes(page);
  for (const n of Object.keys(before)) {
    if (after[n].volumeCm3 !== before[n].volumeCm3) expect(after[n].manifold).toBe(true);
  }

  await undoOnce(page, isMobile);
  await undoOnce(page, isMobile);
  expect(await volumes(page)).toEqual(before);
  await expect(page.locator('[data-testid="cut-undo"]')).toBeHidden();
});
