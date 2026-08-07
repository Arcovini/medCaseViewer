import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");
const TEST_UID = "test-fixture-abc123";

async function mockGlbRoute(page) {
  const body = await fs.readFile(FIXTURE_PATH);
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body });
  });
}

async function openViewer(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case/?id=${TEST_UID}`);
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

// Nome da estrutura da primeira linha (o swatch carrega o mesmo data attr).
async function firstStructure(page) {
  const swatch = page.locator(".struct-swatch").first();
  return { swatch, name: await swatch.getAttribute("data-structure-name") };
}

test("cada estrutura colorida ganha um swatch clicável", async ({ page }) => {
  await openViewer(page);

  // O fixture tem 4 malhas de cor chapada → 4 swatches interativos.
  await expect(page.locator(".struct-swatch")).toHaveCount(4);

  const names = await page.locator(".struct-swatch").evaluateAll((els) =>
    els.map((e) => e.dataset.structureName),
  );
  for (const n of names) expect(n).toBeTruthy();
});

test("clicar no swatch abre o popover de cor com o nome da estrutura", async ({ page }) => {
  await openViewer(page);
  const { swatch, name } = await firstStructure(page);

  const pop = page.locator('[data-testid="color-pop"]');
  await expect(pop).toBeHidden();

  await swatch.click();
  await expect(pop).toBeVisible();
  await expect(page.locator('[data-testid="color-pop-name"]')).toHaveText(name);
  await expect(swatch).toHaveAttribute("aria-expanded", "true");
});

test("escolher um preset repinta a malha no three.js e atualiza o swatch", async ({ page }) => {
  await openViewer(page);
  const { swatch, name } = await firstStructure(page);

  const before = await page.evaluate((n) => window.__world.getMeshColor(n), name);

  await swatch.click();
  // Pega um preset diferente da cor atual pra garantir que houve mudança.
  const target = await page.locator(".color-swatch-opt").evaluateAll((els, cur) => {
    const opt = els.find((e) => e.dataset.hex.toLowerCase() !== cur.toLowerCase());
    return opt.dataset.hex;
  }, before);

  await page.locator(`.color-swatch-opt[data-hex="${target}"]`).click();

  // Three.js: material.color realmente mudou.
  const after = await page.evaluate((n) => window.__world.getMeshColor(n), name);
  expect(after.toLowerCase()).toBe(target.toLowerCase());
  expect(after.toLowerCase()).not.toBe(before.toLowerCase());

  // DOM: a faixa da linha acompanha.
  const cssVar = await page.locator("#structures-list li").first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--struct-color").trim());
  expect(cssVar.toLowerCase()).toBe(target.toLowerCase());

  // O preset aplicado fica marcado como selecionado.
  await expect(page.locator(`.color-swatch-opt[data-hex="${target}"]`))
    .toHaveAttribute("data-selected", "true");
});

test("cor personalizada aplica ao vivo no evento input", async ({ page }) => {
  await openViewer(page);
  const { swatch, name } = await firstStructure(page);

  await swatch.click();
  // `input` (não `change`) é o evento que o color.js escuta, pra repintar
  // enquanto o usuário arrasta no seletor nativo do SO.
  await page.locator('[data-testid="color-pop-custom"]').evaluate((el) => {
    el.value = "#123456";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const after = await page.evaluate((n) => window.__world.getMeshColor(n), name);
  expect(after.toLowerCase()).toBe("#123456");
});

test("Restaurar volta à cor original do GLB", async ({ page }) => {
  await openViewer(page);
  const { swatch, name } = await firstStructure(page);

  const original = await page.evaluate((n) => window.__world.getMeshColor(n), name);
  const reset = page.locator('[data-testid="color-pop-reset"]');

  await swatch.click();
  // Sem edição ainda, não há o que restaurar.
  await expect(reset).toBeDisabled();

  await page.locator('[data-testid="color-pop-custom"]').evaluate((el) => {
    el.value = "#abcdef";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(reset).toBeEnabled();

  await reset.click();
  const after = await page.evaluate((n) => window.__world.getMeshColor(n), name);
  expect(after.toLowerCase()).toBe(original.toLowerCase());
  await expect(reset).toBeDisabled();
});

test("recolorir uma estrutura não afeta as vizinhas", async ({ page }) => {
  await openViewer(page);

  const names = await page.locator(".struct-swatch").evaluateAll((els) =>
    els.map((e) => e.dataset.structureName),
  );
  const others = names.slice(1);
  const beforeOthers = await page.evaluate(
    (ns) => ns.map((n) => window.__world.getMeshColor(n)), others,
  );

  await page.locator(".struct-swatch").first().click();
  await page.locator('[data-testid="color-pop-custom"]').evaluate((el) => {
    el.value = "#ff00ff";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const afterOthers = await page.evaluate(
    (ns) => ns.map((n) => window.__world.getMeshColor(n)), others,
  );
  expect(afterOthers).toEqual(beforeOthers);
});

test("popover fecha com Escape e com clique fora", async ({ page }) => {
  await openViewer(page);
  const pop = page.locator('[data-testid="color-pop"]');

  await page.locator(".struct-swatch").first().click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();

  await page.locator(".struct-swatch").first().click();
  await expect(pop).toBeVisible();
  await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
  await expect(pop).toBeHidden();
});

test("popover fica dentro da viewport ao abrir na última estrutura", async ({ page }) => {
  await openViewer(page);

  await page.locator(".struct-swatch").last().scrollIntoViewIfNeeded();
  await page.locator(".struct-swatch").last().click();

  const pop = page.locator('[data-testid="color-pop"]');
  await expect(pop).toBeVisible();

  const fits = await pop.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0
      && r.right <= window.innerWidth + 0.5
      && r.bottom <= window.innerHeight + 0.5;
  });
  expect(fits).toBe(true);
});
