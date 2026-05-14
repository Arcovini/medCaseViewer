// @ts-check
// v5 chrome: top bar (brand + case-id + AR/Medir/Theme/Share pills),
// right column = structures panel, share modal, theme toggle.
// Drops the legend/foot/case-meta surfaces that lived in v3.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures/sample.glb");
const TEST_UID = "test-fixture-abc123";
const VIEWER_URL = `/case-next/?id=${TEST_UID}`;

async function setup(page) {
  const body = await fs.readFile(FIXTURE_PATH);
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body,
    });
  });
  await page.addInitScript(() => {
    window.__playwrightTest = true;
    try { localStorage.removeItem("medcase-viewer-theme"); } catch (_) {}
  });
}

async function waitForBootstrap(page) {
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

test.describe("case-next v5 chrome", () => {
  test("top bar: brand wordmark + short UID + chrome pills present", async ({ page }) => {
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    await expect(page.locator(".vw-brand-product")).toHaveText("Medcase");
    await expect(page.locator(".vw-brand-company")).toHaveText("por Biodesignlab");
    await expect(page.locator('[data-bind="uid-short"]')).toHaveText(TEST_UID.slice(0, 8));

    // The four chrome pills: AR + Medir + Theme + Compartilhar.
    await expect(page.locator('[data-testid="ar-button"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="measure-fab"]')).toHaveCount(1);
    await expect(page.locator('[data-action="theme-toggle"]')).toHaveCount(1);
    await expect(page.locator('[data-action="share"]')).toHaveCount(1);
  });

  test("zoom chip: visible in desktop, percentage shown, +/- buttons change value", async ({ page, isMobile }) => {
    test.skip(isMobile, "Zoom chip hidden under 768px viewport.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const zoom = page.locator(".vw-zoom");
    await expect(zoom).toBeVisible();
    await expect(page.locator('[data-bind="zoom-pct"]')).toHaveText(/^\d+%$/);

    const valueBefore = await page.locator('[data-bind="zoom-pct"]').textContent();
    await page.locator('[data-action="zoom-in"]').click();
    await expect(page.locator('[data-bind="zoom-pct"]')).not.toHaveText(valueBefore || "");
  });

  test("structures panel: lives on the right column with the layer list", async ({ page, isMobile }) => {
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    // The panel exists and renders the 4 fixture structures.
    await expect(page.locator("#structures-panel")).toHaveCount(1);
    await expect(page.locator("#structures-list li")).toHaveCount(4);

    if (!isMobile) {
      // On desktop the .vw-right slot wraps the panel.
      await expect(page.locator(".vw-right #structures-panel")).toBeVisible();
    }
  });

  test("theme toggle: flips html[data-theme] light↔dark and persists in localStorage", async ({ page }) => {
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.locator('[data-action="theme-toggle"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const stored = await page.evaluate(() => localStorage.getItem("medcase-viewer-theme"));
    expect(stored).toBe("dark");

    await page.locator('[data-action="theme-toggle"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("share modal: opens via top-bar Compartilhar, shows the case URL, closes via X / Escape", async ({ page }) => {
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const scrim = page.locator('[data-testid="share-modal"]');
    await expect(scrim).toBeHidden();

    await page.locator('[data-action="share"]').click();
    await expect(scrim).toBeVisible();
    await expect(page.locator('[data-bind="share-link"]')).toHaveValue(/case-next\/\?id=test-fixture-abc123$/);

    await page.locator('[data-action="share-close"]').click();
    await expect(scrim).toBeHidden();

    // Re-open and close with Escape.
    await page.locator('[data-action="share"]').click();
    await expect(scrim).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(scrim).toBeHidden();
  });

  test("mobile: zoom chip hides, structures panel becomes the bottom sheet", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Asserts mobile-only collapsing.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    await expect(page.locator(".vw-zoom")).toBeHidden();
    // Top bar stays visible.
    await expect(page.locator(".vw-top")).toBeVisible();
    // Bottom sheet (the .panel) is fixed at the bottom on mobile.
    const panelPosition = await page.locator("#structures-panel").evaluate((el) => getComputedStyle(el).position);
    expect(panelPosition).toBe("fixed");
  });
});
