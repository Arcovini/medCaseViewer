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
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: await fixtureBytes(),
    });
  });
}

async function setupCaseNext(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

test("computeMeshVolumeForMesh: cubo 10mm = 1,0 cm³ (±2%)", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(10, 10, 10);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.volumeCm3).toBeCloseTo(1.0, 1);
});

test("computeMeshVolumeForMesh: cubo 20mm = 8,0 cm³ (±2%)", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const geom = new THREE.BoxGeometry(20, 20, 20);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.volumeCm3).toBeCloseTo(8.0, 1);
});

// Para testar manifold detection, construímos tetraedros com vértices
// explicitamente compartilhados. THREE.BoxGeometry/TetrahedronGeometry
// duplicam vértices por face (para ter normais por face), o que faria
// nosso edge-count ver cada aresta como duas. Malhas reais do mesh-processor
// (saída do trimesh / marching cubes) têm vértices compartilhados.

test("computeMeshVolumeForMesh: tetraedro fechado é manifold", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const s = 10;
    const vertices = new Float32Array([0,0,0, s,0,0, 0,s,0, 0,0,s]);
    const indices = [0,2,1, 0,1,3, 0,3,2, 1,2,3];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.manifold).toBe(true);
});

test("computeMeshVolumeForMesh: tetraedro com face removida não é manifold", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const s = 10;
    const vertices = new Float32Array([0,0,0, s,0,0, 0,s,0, 0,0,s]);
    // 3 faces apenas (remove a hipotenusa) → 3 arestas perimetrais aparecem
    // só 1 vez no edge-count → não-manifold.
    const indices = [0,2,1, 0,1,3, 0,3,2];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    const mesh = new THREE.Mesh(geom);
    return window.__world.computeMeshVolumeForMesh(mesh);
  });
  expect(result.manifold).toBe(false);
});

test("computeMeshVolumeCached: retorna valor coerente para mesh do fixture", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    return window.__world.computeMeshVolumeCached(names[0]);
  });
  expect(result).not.toBeNull();
  expect(typeof result.volumeCm3).toBe("number");
  expect(result.volumeCm3).toBeGreaterThan(0);
  expect(typeof result.manifold).toBe("boolean");
});

test("computeMeshVolumeCached: nome inválido retorna null", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() =>
    window.__world.computeMeshVolumeCached("não-existe"),
  );
  expect(result).toBeNull();
});

test("computeMeshVolumeCached: segunda chamada é cacheada (mesmo objeto retornado)", async ({ page }) => {
  await setupCaseNext(page);
  const sameRef = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    const a = window.__world.computeMeshVolumeCached(names[0]);
    const b = window.__world.computeMeshVolumeCached(names[0]);
    return a === b;
  });
  expect(sameRef).toBe(true);
});

test("getMeshCentroid: retorna Vector3 com coordenadas finitas", async ({ page }) => {
  await setupCaseNext(page);
  const c = await page.evaluate(() => {
    const names = window.__world.getMeshNames();
    const v = window.__world.getMeshCentroid(names[0]);
    return { x: v.x, y: v.y, z: v.z };
  });
  expect(Number.isFinite(c.x)).toBe(true);
  expect(Number.isFinite(c.y)).toBe(true);
  expect(Number.isFinite(c.z)).toBe(true);
});

test("getMeshCentroid: nome inválido retorna null", async ({ page }) => {
  await setupCaseNext(page);
  const result = await page.evaluate(() =>
    window.__world.getMeshCentroid("não-existe"),
  );
  expect(result).toBeNull();
});

// ===========================================================================
// Popover do menu de medida (Linear / Volume)
// ===========================================================================

test("popover: estado inicial fechado", async ({ page }) => {
  await setupCaseNext(page);
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
  await expect(page.locator('[data-testid="menu-linear"]')).toBeHidden();
  await expect(page.locator('[data-testid="menu-volume"]')).toBeHidden();
});

test("popover: clicar no FAB abre popover", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "true");
  await expect(page.locator('[data-testid="menu-linear"]')).toBeVisible();
  await expect(page.locator('[data-testid="menu-volume"]')).toBeVisible();
});

test("popover: outside-click fecha", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "true");
  // clica num ponto fora do popover e fora do FAB
  await page.mouse.click(50, 50);
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
});

test("popover: clicar em Linear fecha popover e inicia modo linear", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-linear"]').click();
  await expect(page.locator(".measure-menu")).toHaveAttribute("data-open", "false");
  expect(await page.evaluate(() => window.__measurement.getState())).toBe("placing-p1");
});

// ===========================================================================
// Modo Volume — máquina de estado
// ===========================================================================

test("volume / estado inicial é idle", async ({ page }) => {
  await setupCaseNext(page);
  const state = await page.evaluate(() => window.__volume.getState());
  expect(state).toBe("idle");
});

test("volume / picking Volume entra em active-empty com hint e toolbar", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-empty");
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText(/toque na estrutura para medir o volume/i);
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-exit"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-new"]')).toBeHidden();
});

test("volume / Sair em active-empty volta a idle + reapresenta FAB", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await page.locator('[data-testid="btn-volume-exit"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("idle");
  await expect(page.locator('[data-testid="measure-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeHidden();
});

// Reusa o helper tapNearMesh do case-next.spec.js, declarado localmente.
async function tapNearMesh(page, targetX, targetY) {
  const hitCoord = await page.evaluate(([tx, ty]) => {
    const w = window.__world;
    if (w.raycastFromScreen(tx, ty)) return { x: tx, y: ty };
    for (let r = 20; r <= 200; r += 20) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const sx = tx + Math.cos(a) * r;
        const sy = ty + Math.sin(a) * r;
        if (w.raycastFromScreen(sx, sy)) return { x: sx, y: sy };
      }
    }
    return null;
  }, [targetX, targetY]);
  if (!hitCoord) throw new Error(`No mesh near (${targetX}, ${targetY})`);
  await page.mouse.click(hitCoord.x, hitCoord.y);
  return hitCoord;
}

async function tapCanvasCenter(page) {
  const box = await page.locator("#canvas").boundingBox();
  return tapNearMesh(page, box.x + box.width / 2, box.y + box.height / 2);
}

test("volume / tap em estrutura transiciona pra active-result", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-result");
  const measuredName = await page.evaluate(() => window.__volume.getMeasuredMesh());
  expect(measuredName).not.toBeNull();
});

test("volume / pílula com formato XX,X cm³ aparece após tap", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  const text = await page.evaluate(() => window.__volume.getPillText());
  // formato: dígitos + vírgula + 1 dígito + " cm³", com prefixo opcional "~"
  expect(text).toMatch(/^~?\d+,\d cm³$/);
  await expect(page.locator(".measurement-pill")).toBeVisible();
});

test("volume / toolbar em active-result mostra +Nova e Sair", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  await expect(page.locator('[data-testid="btn-volume-new"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-volume-exit"]')).toBeVisible();
});

test("volume / + Nova volta a active-empty mantendo modo", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-volume-new"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("active-empty");
  expect(await page.evaluate(() => window.__volume.getMeasuredMesh())).toBeNull();
  await expect(page.locator(".measurement-pill")).toBeHidden();
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText(/toque na estrutura/i);
  await expect(page.locator('[data-testid="measure-fab"]')).toBeHidden();
});

test("volume / Sair em active-result limpa tudo e reapresenta FAB", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-volume-exit"]').click();

  expect(await page.evaluate(() => window.__volume.getState())).toBe("idle");
  expect(await page.evaluate(() => window.__volume.getMeasuredMesh())).toBeNull();
  await expect(page.locator(".measurement-pill")).toBeHidden();
  await expect(page.locator('[data-testid="measure-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="volume-toolbar"]')).toBeHidden();
});

test("volume / pílula recebe data-warn=true quando malha não-manifold", async ({ page }) => {
  await setupCaseNext(page);

  // Injeta no cache de volume um resultado non-manifold para TODAS as malhas
  // do fixture. Assim qualquer mesh que o tap acertar retorna manifold=false.
  // Desacopla o teste da topologia exata das malhas (que pode mudar).
  await page.evaluate(() => {
    for (const n of window.__world.getMeshNames()) {
      window.__world.__testInjectVolumeCache(n, { volumeCm3: 12.3, manifold: false });
    }
  });

  await page.locator('[data-testid="measure-fab"]').click();
  await page.locator('[data-testid="menu-volume"]').click();
  await tapCanvasCenter(page);

  const pillData = await page.evaluate(() => {
    const el = document.querySelector(".measurement-pill");
    return el ? { text: el.textContent, warn: el.dataset.warn } : null;
  });

  const bg = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".measurement-pill")).backgroundColor
  );

  expect(pillData).not.toBeNull();
  expect(pillData.warn).toBe("true");
  // pílula contém "~12,3 cm³"; o " ⚠" vem do ::after e pode aparecer no textContent
  expect(pillData.text).toMatch(/^~12,3 cm³/);
  // gold #ffb000 → rgb(255, 176, 0)
  expect(bg).toBe("rgb(255, 176, 0)");
});
