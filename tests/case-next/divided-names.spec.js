import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Gerada pelo mesh-processor com uma divisão real (ver processor.process_stls
// com boolean_ops): 3 nós — "Rim", "Tumor fora de Rim", "Tumor dentro de Rim".
const FIXTURE_PATH = path.join(__dirname, "fixtures/divided.glb");
const TEST_UID = "divided-fixture-xyz789";

test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(30_000); });

async function openViewer(page) {
  await page.addInitScript(() => { window.__playwrightTest = true; });
  const body = await fs.readFile(FIXTURE_PATH);
  await page.route(`**/cases/${TEST_UID}.glb`, async (route) => {
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body });
  });
  await page.goto(`/case/?id=${TEST_UID}`);
  await expect(page.locator("#structures-list li")).toHaveCount(3, { timeout: 10_000 });
}

// O GLTFLoader sanitiza nomes de nó (espaço -> "_"). Sem a dessanitização em
// dom.displayLabel o clínico leria "Tumor_dentro_de_Rim", diferente do rótulo
// que ele configurou na tela de upload.
test("peças de uma divisão aparecem com espaços, não underscores", async ({ page }) => {
  await openViewer(page);

  const nomes = await page.locator(".structure-name").allTextContents();
  expect(nomes.map((n) => n.trim())).toEqual([
    "Rim",
    "Tumor fora de Rim",
    "Tumor dentro de Rim",
  ]);
  for (const n of nomes) expect(n).not.toContain("_");
});

test("o nome legível também vai para aria-label e popover de cor", async ({ page }) => {
  await openViewer(page);

  const swatch = page
    .locator(`.struct-swatch[data-structure-name="Tumor_dentro_de_Rim"]`)
    .first();
  // O identificador segue sanitizado (é a chave de lookup no world.js); só o
  // texto visível e os rótulos de acessibilidade são dessanitizados.
  await expect(swatch).toHaveAttribute("aria-label", "Alterar cor de Tumor dentro de Rim");
  await expect(
    page.locator(`.opacity-slider[data-structure-name="Tumor_dentro_de_Rim"]`),
  ).toHaveAttribute("aria-label", "Opacidade de Tumor dentro de Rim");

  await swatch.click();
  await expect(page.locator('[data-testid="color-pop"]')).toHaveAttribute("data-open", "true");
  await expect(page.locator('[data-testid="color-pop-name"]')).toHaveText(
    "Tumor dentro de Rim",
  );
});

test("a peça interna chega destacada e a externa não herda o destaque", async ({
  page,
}) => {
  await openViewer(page);

  // Cores vêm do backend no GLB; o swatch as espelha via --struct-color.
  //
  // ATENÇÃO aos valores: o backend grava o hex sRGB direto em baseColorFactor,
  // que o glTF define como LINEAR, então o viewer converte linear->sRGB na
  // leitura e o swatch mostra um tom mais claro que o hex pretendido
  // (#FFE100 -> #fff100, #08E700 -> #32f400, e o rim #BA5531 -> #de9c79).
  // Isto é um desvio de espaço de cor anterior a esta feature, não parte dela;
  // o teste registra o comportamento atual. Se o backend passar a converter
  // sRGB->linear, estes esperados viram os hexes originais.
  const cor = async (nome) =>
    page
      .locator(`li[data-structure-name="${nome}"]`)
      .evaluate((el) => el.style.getPropertyValue("--struct-color").trim().toLowerCase());

  const dentro = await cor("Tumor_dentro_de_Rim");
  const fora = await cor("Tumor_fora_de_Rim");

  expect(dentro).toBe("#fff100"); // amarelo de destaque
  expect(fora).toBe("#32f400"); // verde de tumor, preservado
  expect(dentro).not.toBe(fora);
});
