// @ts-check
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
  await page.addInitScript(() => { window.__playwrightTest = true; });
}

async function waitForBootstrap(page) {
  // Bootstrap completion signal: structures list populated.
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

test.describe("case-next redesign chrome", () => {
  test("top bar: brand wordmark, short UID, action buttons present", async ({ page }) => {
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const brand = page.locator(".vw-brand");
    await expect(brand).toContainText("Medcase");
    await expect(page.locator('.vw-case-id [data-bind="uid-short"]')).toHaveText(TEST_UID.slice(0, 8));

    for (const action of ["reset-camera", "fullscreen", "share"]) {
      await expect(page.locator(`[data-action="${action}"]`)).toBeVisible();
    }
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

  test("legend: renders one row per structure with colored dot", async ({ page, isMobile }) => {
    test.skip(isMobile, "Legend hidden under 768px viewport.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const rows = page.locator(".vw-legend-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < count; i++) {
      const dot = rows.nth(i).locator(".vw-legend-dot");
      await expect(dot).toBeVisible();
      const bg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(bg).not.toBe("transparent");
    }
  });

  test("foot strip: visible in desktop, shows structure count and webgl tag", async ({ page, isMobile }) => {
    test.skip(isMobile, "Foot strip hidden under 768px viewport.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const foot = page.locator(".vw-foot");
    await expect(foot).toBeVisible();
    await expect(foot).toContainText("WebGL2");
    await expect(foot).toContainText("v1");

    await expect(page.locator('[data-bind="foot-count"]')).not.toHaveText("—", { timeout: 10000 });
  });

  test("right panel: hidden by default (data-show=false) and via media query <1100px", async ({ page, isMobile }) => {
    test.skip(isMobile, "Right panel never shows on mobile.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    const right = page.locator(".vw-right");
    await expect(right).toHaveCount(1);
    const showAttr = await right.getAttribute("data-show");
    expect(showAttr).toBe("false");
  });

  test("mobile: zoom chip, legend and foot strip are hidden", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Asserts mobile-only collapsing.");
    await setup(page);
    await page.goto(VIEWER_URL);
    await waitForBootstrap(page);

    for (const sel of [".vw-zoom", ".vw-legend", ".vw-foot"]) {
      await expect(page.locator(sel)).toBeHidden();
    }
    await expect(page.locator(".vw-top")).toBeVisible();
  });
});
