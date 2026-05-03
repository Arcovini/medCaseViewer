import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");

const TEST_UID = "test-fixture-abc123";

async function fixtureBytes() {
  return fs.readFile(FIXTURE_PATH);
}

// Intercepta qualquer request para o GLB do fixture e responde com os bytes locais.
// Isso desacopla o teste de R2 e da rede.
async function mockGlbRoute(page, statusOverride = 200) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    if (statusOverride !== 200) {
      await route.fulfill({ status: statusOverride });
      return;
    }
    const body = await fixtureBytes();
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body,
    });
  });
}

test("smoke: canvas renderiza conteúdo do GLB do fixture", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  const canvas = page.locator("#canvas");
  await expect(canvas).toBeVisible();

  // Aguarda o painel renderizar (sinal de que main.js terminou a pipeline)
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  await expect(page.locator("#error")).toBeHidden();
});

test("painel renderiza nomes das estruturas do fixture", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  // Wait for the panel to render
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  // Each structure name should be a non-empty string.
  const names = await page.locator("#structures-list .structure-name").allTextContents();
  expect(names).toHaveLength(4);
  for (const name of names) {
    expect(name.trim().length).toBeGreaterThan(0);
  }
});

test("toggle de eye-button esconde e mostra a estrutura na cena", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  // Wait for the panel to render
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  // Take the first eye-toggle button and read its structure name from the data attr.
  const firstButton = page.locator(".eye-toggle").first();
  const name = await firstButton.getAttribute("data-structure-name");
  expect(name).not.toBeNull();
  expect(name.length).toBeGreaterThan(0);

  // Initial state: visible
  let visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(true);
  await expect(firstButton).toHaveAttribute("data-visible", "true");

  // Click 1 — hide
  await firstButton.click();
  visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(false);
  await expect(firstButton).toHaveAttribute("data-visible", "false");

  // Click 2 — show again
  await firstButton.click();
  visible = await page.evaluate((n) => window.__world.getMeshVisibility(n), name);
  expect(visible).toBe(true);
  await expect(firstButton).toHaveAttribute("data-visible", "true");
});

test("URL sem ?id= mostra mensagem de erro", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await page.goto("/case-next/");

  const errorEl = page.locator("#error");
  await expect(errorEl).toBeVisible();
  await expect(errorEl).toContainText("UID do caso não informado");
});

test("UID inexistente (404 do R2) mostra mensagem de erro", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page, 404);  // helper retorna 404 em vez do fixture
  await page.goto(`/case-next/?id=${TEST_UID}`);

  const errorEl = page.locator("#error");
  await expect(errorEl).toBeVisible();
  await expect(errorEl).toContainText("Caso não encontrado");
  await expect(errorEl).toContainText(TEST_UID);
});

test("setOpacity numa estrutura não afeta opacity das outras (clone defensivo)", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  const names = await page.evaluate(() => window.__world.getMeshNames());
  expect(names.length).toBeGreaterThanOrEqual(2);

  // Default: ambos em 1.0
  const before = await page.evaluate((ns) => ns.map((n) => window.__world.getMeshOpacity(n)), names);
  for (const v of before) expect(v).toBe(1);

  // Mudar opacity só do primeiro
  await page.evaluate(([n, v]) => window.__world.setOpacity(n, v), [names[0], 0.5]);

  // Primeiro reflete; o segundo não deve ter mudado
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), names[0])).toBe(0.5);
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), names[1])).toBe(1);
});

test("setVisibility(name,true) restaura último opacity não-zero após drag→0", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const names = await page.evaluate(() => window.__world.getMeshNames());
  const target = names[0];

  // Definir opacity em 0.7 — vira "último valor não-zero"
  await page.evaluate(([n]) => window.__world.setOpacity(n, 0.7), [target]);
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), target)).toBe(0.7);

  // Drag até 0 — mesh some (visible=false), mas lastOpacity preservado em 0.7
  await page.evaluate(([n]) => window.__world.setOpacity(n, 0), [target]);
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), target)).toBe(false);

  // Re-acender via setVisibility(true) — opacity deve voltar pra 0.7, não pra 1.0
  await page.evaluate(([n]) => window.__world.setVisibility(n, true), [target]);
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), target)).toBe(true);
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), target)).toBe(0.7);
});

test("setVisibility(name,true) usa default 1.0 quando lastOpacity nunca foi setado", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const names = await page.evaluate(() => window.__world.getMeshNames());
  const target = names[0];

  // Sem nunca chamar setOpacity, esconder e religar — opacity deve ser 1.0
  await page.evaluate(([n]) => window.__world.setVisibility(n, false), [target]);
  await page.evaluate(([n]) => window.__world.setVisibility(n, true), [target]);
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), target)).toBe(true);
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), target)).toBe(1);
});

test("getMeshColor retorna string hex válida do material", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  const names = await page.evaluate(() => window.__world.getMeshNames());
  const colors = [];
  for (const name of names) {
    const color = await page.evaluate((n) => window.__world.getMeshColor(n), name);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    colors.push(color);
  }
  // Guards against silent black-fallback if GLTFLoader ever stops reading baseColorFactor.
  expect(colors.some((c) => c !== "#000000")).toBe(true);
});
