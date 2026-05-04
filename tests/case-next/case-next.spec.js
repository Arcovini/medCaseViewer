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

test("painel renderiza um slider em cada estrutura, default 1.0", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  await expect(page.locator(".opacity-slider")).toHaveCount(4);

  const values = await page.locator(".opacity-slider").evaluateAll((els) => els.map((e) => e.value));
  for (const v of values) expect(v).toBe("1");
});

test("cada <li> recebe --struct-color batendo com world.getMeshColor", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  const items = await page.locator("#structures-list li").evaluateAll((els) =>
    els.map((e) => ({
      name: e.querySelector(".eye-toggle")?.dataset.structureName,
      color: getComputedStyle(e).getPropertyValue("--struct-color").trim().toLowerCase(),
    })),
  );

  for (const item of items) {
    expect(item.name).toBeTruthy();
    const expected = (await page.evaluate((n) => window.__world.getMeshColor(n), item.name)).toLowerCase();
    expect(item.color).toBe(expected);
  }
});

test("arrastar o slider chama world.setOpacity para aquela estrutura", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  const firstLi = page.locator("#structures-list li").first();
  const name = await firstLi.locator(".eye-toggle").getAttribute("data-structure-name");

  await firstLi.locator(".opacity-slider").evaluate((el) => {
    el.value = "0.4";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), name)).toBeCloseTo(0.4, 5);
});

test("dom.setEyeState atualiza DOM sem afetar a visibilidade no world", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const firstLi = page.locator("#structures-list li").first();
  const name = await firstLi.locator(".eye-toggle").getAttribute("data-structure-name");

  // Estado inicial: olho ON e mesh visível
  await expect(firstLi.locator(".eye-toggle")).toHaveAttribute("data-visible", "true");
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(true);

  // Chamar setEyeState diretamente: DOM muda; world.getMeshVisibility NÃO muda
  await page.evaluate((n) => window.__dom.setEyeState(n, false), name);
  await expect(firstLi.locator(".eye-toggle")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(true);
});

test("dom.setSliderValue atualiza value sem afetar a opacity no world", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const firstLi = page.locator("#structures-list li").first();
  const name = await firstLi.locator(".eye-toggle").getAttribute("data-structure-name");

  // Estado inicial: opacity 1 no world
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), name)).toBe(1);

  // Chamar setSliderValue diretamente: slider muda; world.getMeshOpacity NÃO muda
  await page.evaluate((n) => window.__dom.setSliderValue(n, 0.3), name);
  const sliderVal = await firstLi.locator(".opacity-slider").evaluate((el) => el.value);
  expect(parseFloat(sliderVal)).toBeCloseTo(0.3, 5);
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), name)).toBe(1);
});

test("slider em 0 esconde o mesh e marca o olho como OFF", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const firstLi = page.locator("#structures-list li").first();
  const name = await firstLi.locator(".eye-toggle").getAttribute("data-structure-name");

  await firstLi.locator(".opacity-slider").evaluate((el) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(await page.evaluate((n) => window.__world.getMeshVisibility(n), name)).toBe(false);
  await expect(firstLi.locator(".eye-toggle")).toHaveAttribute("data-visible", "false");
});

test("religar olho após slider→0 restaura último opacity não-zero (não 1.0)", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const firstLi = page.locator("#structures-list li").first();
  const name = await firstLi.locator(".eye-toggle").getAttribute("data-structure-name");

  // Drag até 0.5
  await firstLi.locator(".opacity-slider").evaluate((el) => {
    el.value = "0.5";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Drag até 0
  await firstLi.locator(".opacity-slider").evaluate((el) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Religar via click no olho
  await firstLi.locator(".eye-toggle").click();

  // Opacity volta pra 0.5 e slider acompanha
  expect(await page.evaluate((n) => window.__world.getMeshOpacity(n), name)).toBeCloseTo(0.5, 5);
  const sliderVal = await firstLi.locator(".opacity-slider").evaluate((el) => parseFloat(el.value));
  expect(sliderVal).toBeCloseTo(0.5, 5);
});

test("desligar olho via click direto leva slider visualmente a 0", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
  const firstLi = page.locator("#structures-list li").first();

  // Slider começa em 1
  let sliderVal = await firstLi.locator(".opacity-slider").evaluate((el) => parseFloat(el.value));
  expect(sliderVal).toBeCloseTo(1, 5);

  // Click no olho — deve ir pra 0
  await firstLi.locator(".eye-toggle").click();
  sliderVal = await firstLi.locator(".opacity-slider").evaluate((el) => parseFloat(el.value));
  expect(sliderVal).toBeCloseTo(0, 5);

  // Click novamente — deve voltar pra 1 (default, nunca foi mexido)
  await firstLi.locator(".eye-toggle").click();
  sliderVal = await firstLi.locator(".opacity-slider").evaluate((el) => parseFloat(el.value));
  expect(sliderVal).toBeCloseTo(1, 5);
});

test("<li> tem layout em coluna e position relative para a faixa lateral", async ({ page }) => {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);

  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });

  const firstLi = page.locator("#structures-list li").first();
  const styles = await firstLi.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      flexDirection: cs.flexDirection,
      position: cs.position,
      paddingLeft: cs.paddingLeft,
    };
  });
  expect(styles.flexDirection).toBe("column");
  expect(styles.position).toBe("relative");
  // Stripe é 3px @ left:6px (até x=9). Conteúdo precisa começar bem depois — padding-left ≥ 14px é o piso útil.
  expect(parseInt(styles.paddingLeft, 10)).toBeGreaterThanOrEqual(14);
});

// ===========================================================================
// Sprint 3b.2 — Medição linear
// ===========================================================================

async function setupCaseNext(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  await mockGlbRoute(page);
  await page.goto(`/case-next/?id=${TEST_UID}`);
  // Espera o painel renderizar (sinal que main.js terminou e measurement.init() rodou).
  await expect(page.locator("#structures-list li")).toHaveCount(4, { timeout: 10_000 });
}

async function getMeasurementState(page) {
  return page.evaluate(() => window.__measurement.getState());
}

// Procura uma coordenada de tela próxima ao alvo que atinja alguma malha,
// e clica lá. Necessário porque o fixture sample.glb pode não ter geometria
// exatamente em coords arbitrárias — busca em espiral ao redor do alvo.
async function tapNearMesh(page, targetX, targetY) {
  const hitCoord = await page.evaluate(([tx, ty]) => {
    const w = window.__world;
    // Tenta o ponto-alvo primeiro, depois espiral expandindo em passos de 20px.
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
  if (!hitCoord) throw new Error(`No mesh found in canvas near (${targetX}, ${targetY})`);
  await page.mouse.click(hitCoord.x, hitCoord.y);
  return hitCoord;
}

async function tapCanvasCenter(page) {
  const box = await page.locator("#canvas").boundingBox();
  return tapNearMesh(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function tapCanvasOffset(page, dx, dy) {
  const box = await page.locator("#canvas").boundingBox();
  return tapNearMesh(page, box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test("3b.2 / FAB aparece após carregamento com label Medir", async ({ page }) => {
  await setupCaseNext(page);
  const fab = page.locator('[data-testid="measure-fab"]');
  await expect(fab).toBeVisible();
  await expect(fab).toContainText("Medir");
  await expect(fab).toHaveAttribute("data-state", "idle");
});

test("3b.2 / tap no FAB transiciona pra placing-p1", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  expect(await getMeasurementState(page)).toBe("placing-p1");
  await expect(page.locator('[data-testid="measure-hint"]')).toBeVisible();
  // FAB fica oculto durante placing — toolbar inferior cuida do cancelar.
  await expect(page.locator('[data-testid="measure-fab"]')).toBeHidden();
});

test("3b.2 / tap no canvas cria candidato e mostra toolbar de confirmação", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await tapCanvasCenter(page);

  const cand = await page.evaluate(() => window.__measurement.getCandidate());
  expect(cand).not.toBeNull();

  await expect(page.locator('[data-testid="btn-confirm"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-cancel"]')).toBeVisible();
});

test("3b.2 / Confirmar P1 transiciona pra placing-p2 com endpoint fixado", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-confirm"]').click();

  expect(await getMeasurementState(page)).toBe("placing-p2");
  const endpoints = await page.evaluate(() => window.__measurement.getEndpoints());
  expect(endpoints).toHaveLength(1);
  await expect(page.locator('[data-testid="measure-hint"]')).toContainText(/segundo ponto/i);
});

test("3b.2 / fluxo completo até pílula com formato XX,X mm", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-confirm"]').click();

  // Tap num offset razoável pra garantir distância > 0.
  await tapCanvasOffset(page, 100, 50);
  await page.locator('[data-testid="btn-confirm"]').click();

  expect(await getMeasurementState(page)).toBe("result");
  const line = await page.evaluate(() => window.__measurement.getLine());
  expect(line).not.toBeNull();
  expect(line.distanceMm).toBeGreaterThan(0);

  const pillText = await page.evaluate(() => window.__measurement.getPillText());
  expect(pillText).toMatch(/^\d+,\d mm$/);
});

test("3b.2 / Limpar volta ao idle com tudo zerado", async ({ page }) => {
  await setupCaseNext(page);
  await page.locator('[data-testid="measure-fab"]').click();
  await tapCanvasCenter(page);
  await page.locator('[data-testid="btn-confirm"]').click();
  await tapCanvasOffset(page, 100, 50);
  await page.locator('[data-testid="btn-confirm"]').click();

  await page.locator('[data-testid="btn-clear"]').click();
  expect(await getMeasurementState(page)).toBe("idle");
  const endpoints = await page.evaluate(() => window.__measurement.getEndpoints());
  expect(endpoints).toHaveLength(0);
  const line = await page.evaluate(() => window.__measurement.getLine());
  expect(line).toBeNull();
  await expect(page.locator('[data-testid="measure-fab"]')).toContainText("Medir");
});
