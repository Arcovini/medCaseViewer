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
