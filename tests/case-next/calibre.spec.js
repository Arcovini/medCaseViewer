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

async function mockGlbRoute(page) {
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    const body = await fixtureBytes();
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body });
  });
}

async function gotoCaseAndWait(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case/?id=${TEST_UID}`);
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

test("calibre / menu de medição contém item Calibre", async ({ page }) => {
  await gotoCaseAndWait(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator('[data-testid="menu-calibre"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-calibre"] .l1')).toHaveText("Calibre");
});

test("calibre / window.__calibre expõe API esperada", async ({ page }) => {
  await gotoCaseAndWait(page);
  const api = await page.evaluate(() => ({
    hasGetState: typeof window.__calibre?.getState === "function",
    hasStartCalibre: typeof window.__calibre?.startCalibre === "function",
    hasGetCommittedCount: typeof window.__calibre?.getCommittedCount === "function",
    hasOnMeshVisibilityChange: typeof window.__calibre?.onMeshVisibilityChange === "function",
    initialState: window.__calibre?.getState(),
  }));
  expect(api.hasGetState).toBe(true);
  expect(api.hasStartCalibre).toBe(true);
  expect(api.hasGetCommittedCount).toBe(true);
  expect(api.hasOnMeshVisibilityChange).toBe(true);
  expect(api.initialState).toBe("idle");
});

test("calibre / tap em Calibre no menu transiciona pra placing-p1 + mostra toolbar", async ({ page }) => {
  await gotoCaseAndWait(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-calibre"]').click();
  // State machine deve estar em placing-p1
  const state = await page.evaluate(() => window.__calibre.getState());
  expect(state).toBe("placing-p1");
  // Toolbar de calibre deve estar visível com botão Cancelar
  await expect(page.locator('[data-testid="calibre-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-calibre-cancel"]')).toBeVisible();
});

test("calibre / world.js expõe APIs do calibre (getMeshTriangleSoup, raycastInternal, addCenterline...)", async ({ page }) => {
  await gotoCaseAndWait(page);
  const apis = await page.evaluate(() => ({
    getMeshTriangleSoup: typeof window.__world.getMeshTriangleSoup === "function",
    getMeshFaceNormalWorld: typeof window.__world.getMeshFaceNormalWorld === "function",
    raycastInternal: typeof window.__world.raycastInternal === "function",
    addCenterline: typeof window.__world.addCenterline === "function",
    removeCenterline: typeof window.__world.removeCenterline === "function",
    pickPointOnCenterline: typeof window.__world.pickPointOnCenterline === "function",
    addDiameterCircle: typeof window.__world.addDiameterCircle === "function",
    updateDiameterCircle: typeof window.__world.updateDiameterCircle === "function",
    removeDiameterCircle: typeof window.__world.removeDiameterCircle === "function",
  }));
  for (const [name, present] of Object.entries(apis)) {
    expect(present, `world.${name} should exist`).toBe(true);
  }
});

test("calibre / cancel volta pra idle e re-mostra o FAB", async ({ page }) => {
  await gotoCaseAndWait(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-calibre"]').click();
  expect(await page.evaluate(() => window.__calibre.getState())).toBe("placing-p1");
  await page.locator('[data-testid="btn-calibre-cancel"]').click();
  expect(await page.evaluate(() => window.__calibre.getState())).toBe("idle");
  await expect(page.locator('[data-testid="measure-fab"]')).toBeVisible();
});

test("calibre / getMeshTriangleSoup retorna positions Float32Array em world-space pro mesh do fixture", async ({ page }) => {
  await gotoCaseAndWait(page);
  const info = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    const first = names[0];
    const soup = window.__world.getMeshTriangleSoup(first);
    return {
      name: first,
      hasSoup: !!soup,
      positionsCtor: soup?.positions?.constructor?.name,
      positionsLength: soup?.positions?.length,
      hasIndices: !!soup?.indices,
    };
  });
  expect(info.hasSoup).toBe(true);
  expect(info.positionsCtor).toBe("Float32Array");
  expect(info.positionsLength).toBeGreaterThan(0);
});

test("calibre / addCenterline + removeCenterline com pontos arbitrários", async ({ page }) => {
  await gotoCaseAndWait(page);
  const result = await page.evaluate(() => {
    // 3-point fake centerline
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 5, z: 0 },
    ];
    const THREE = window.__world.__three ?? null; // not exported; usa Vector3-like duck
    // world.addCenterline expects THREE.Vector3 instances — usa o construtor via measurement
    // Em vez disso, monta via objeto que se comporta como Vector3 (clone + x/y/z são suficientes)
    const fakeV3 = (x, y, z) => ({
      x, y, z,
      clone() { return fakeV3(this.x, this.y, this.z); },
      distanceTo(o) { const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z; return Math.hypot(dx, dy, dz); },
      lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; },
      copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; },
      sub(o) { this.x -= o.x; this.y -= o.y; this.z -= o.z; return this; },
      normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; },
      subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; },
    });
    const v3Pts = pts.map(p => fakeV3(p.x, p.y, p.z));
    let id;
    try {
      id = window.__world.addCenterline(v3Pts);
    } catch (e) {
      return { error: e.message };
    }
    const after = typeof id === "number";
    window.__world.removeCenterline(id);
    return { ok: after, id };
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
});
