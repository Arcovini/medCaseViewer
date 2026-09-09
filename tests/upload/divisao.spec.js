/* Isolar partes na tela de upload: a lista de estruturas como prévia, o menu de
 * referência, encadeamento, cancelar e o POST real para o mesh-processor.
 *
 * Precisa do backend local em DRY_RUN na porta 8000. Sem ele os testes que
 * dependem de rede se PULAM (não falham), com a instrução de como subir —
 * `npx playwright test` continua útil para quem não tem o backend em mão.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(__dirname, "fixtures", n);

const RIM = fx("Rim.stl");
const TUMOR = fx("Tumor.stl"); // sobrepõe o rim parcialmente
const COLUNA = fx("Coluna.stl"); // sobrepõe a parte externa do tumor
const LONGE = fx("Longe.stl"); // não toca nada

const BACKEND = "http://localhost:8000";
const COMO_SUBIR =
  "backend ausente: DRY_RUN=true uvicorn main:app --port 8000 no repo mesh-processor";

let backendUp = false;
test.beforeAll(async ({ request }) => {
  try {
    backendUp = (await request.get(`${BACKEND}/health`, { timeout: 2000 })).ok();
  } catch {
    backendUp = false;
  }
});

async function abrirUpload(page) {
  await page.goto("/upload/");
  await expect(page.locator("#state-idle")).toBeVisible();
}

async function escolher(page, arquivos) {
  await page.setInputFiles("#file-input", arquivos);
  await expect(page.locator("#structure-list .up-row")).toHaveCount(arquivos.length);
}

const linha = (page, nome) =>
  page.locator(".up-row").filter({ has: page.locator(`.up-row-name:text-is("${nome}")`) });

// Isola `alvo` dentro de `referencia` pelo menu da própria linha.
async function isolar(page, alvo, referencia) {
  await linha(page, alvo).getByRole("button", { name: /Isolar uma parte/ }).click();
  await page.locator(".up-menu-item", { hasText: referencia }).first().click();
}

const nomes = (page) => page.locator(".up-row-name").allInnerTexts();

test.describe("a lista é a prévia", () => {
  test("sem isolamento, uma linha por arquivo e nenhum trilho", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    expect(await nomes(page)).toEqual(["Rim", "Tumor", "Coluna"]);
    await expect(page.locator('.up-group[data-split="true"]')).toHaveCount(0);
    await expect(page.locator("#btn-process")).toBeEnabled();
  });

  test("isolar parte a linha em duas, sob um trilho", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await isolar(page, "Tumor", "Rim");

    expect(await nomes(page)).toEqual(["Rim", "Tumor fora de Rim", "Tumor dentro de Rim"]);
    await expect(page.locator('.up-group[data-split="true"]')).toHaveCount(1);
    await expect(page.locator('.up-row[data-isolated="true"]')).toHaveCount(1);
    // A estrutura original não sobrevive: ela virou duas peças.
    expect(await nomes(page)).not.toContain("Tumor");
  });

  test("encadear acrescenta linha ao mesmo grupo, sem aninhar trilho", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await isolar(page, "Tumor", "Rim");
    await isolar(page, "Tumor fora de Rim", "Coluna");

    expect(await nomes(page)).toEqual([
      "Rim",
      "Tumor fora de Rim fora de Coluna",
      "Tumor fora de Rim dentro de Coluna",
      "Tumor dentro de Rim",
      "Coluna",
    ]);
    // Um trilho só, por mais que se encadeie: o grupo é da estrutura de origem.
    await expect(page.locator('.up-group[data-split="true"]')).toHaveCount(1);
    await expect(page.locator(".up-group-rows .up-group-rows")).toHaveCount(0);
  });
});

test.describe("limites que o backend impõe", () => {
  test("a peça isolada não pode ser isolada de novo nem virar referência", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await isolar(page, "Tumor", "Rim");

    // _apply_boolean_ops indexa por nome ORIGINAL: a peça amarela não existe lá.
    const isolada = page.locator('.up-row[data-isolated="true"]');
    await expect(isolada.getByRole("button", { name: /Isolar uma parte/ })).toHaveCount(0);

    await linha(page, "Coluna").getByRole("button", { name: /Isolar uma parte/ }).click();
    const opcoes = await page.locator(".up-menu-item").allInnerTexts();
    expect(opcoes.join(" ")).not.toContain("dentro de");
  });

  test("a mesma referência não é oferecida duas vezes para o mesmo alvo", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await isolar(page, "Tumor", "Rim");

    await linha(page, "Tumor fora de Rim")
      .getByRole("button", { name: /Isolar uma parte/ })
      .click();
    const opcoes = await page.locator(".up-menu-item").allInnerTexts();
    expect(opcoes.some((o) => o.includes("Coluna"))).toBe(true);
    expect(opcoes.some((o) => o.startsWith("Rim"))).toBe(false);
  });

  test("sem 2+ STLs não há o que isolar", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM]);
    await expect(page.getByRole("button", { name: /Isolar uma parte/ })).toHaveCount(0);
    await expect(page.locator("#btn-process")).toBeEnabled();
  });
});

test.describe("editar e desfazer", () => {
  test("o token troca a referência das duas peças de uma vez", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await isolar(page, "Tumor", "Rim");

    await page.locator(".up-token").click();
    await page.locator(".up-menu-item", { hasText: "Coluna" }).first().click();

    expect(await nomes(page)).toEqual([
      "Rim",
      "Tumor fora de Coluna",
      "Tumor dentro de Coluna",
      "Coluna",
    ]);
  });

  test("desfazer devolve a estrutura inteira", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await isolar(page, "Tumor", "Rim");
    await page.getByRole("button", { name: /Desfazer/ }).click();

    expect(await nomes(page)).toEqual(["Rim", "Tumor"]);
    await expect(page.locator('.up-group[data-split="true"]')).toHaveCount(0);
  });
});

test.describe("cancelar", () => {
  test("sem nada isolado, volta direto ao início", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await page.click("#btn-cancel");

    await expect(page.locator("#pick-files")).toBeVisible();
    await expect(page.locator("#structures")).toBeHidden();
    await expect(page.locator("#btn-process")).toBeDisabled();
  });

  test("com partes isoladas, pergunta antes e 'Manter' preserva", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await isolar(page, "Tumor", "Rim");

    await page.click("#btn-cancel");
    await expect(page.locator("#cancel-confirm")).toBeVisible();
    await expect(page.locator("#cancel-confirm-text")).toHaveText("Descartar 1 parte isolada?");

    await page.click("#btn-cancel-keep");
    await expect(page.locator("#cancel-confirm")).toBeHidden();
    expect(await nomes(page)).toContain("Tumor dentro de Rim");

    await page.click("#btn-cancel");
    await page.click("#btn-cancel-discard");
    await expect(page.locator("#pick-files")).toBeVisible();
  });
});

test.describe("linguagem clínica", () => {
  test("nenhum jargão de geometria aparece para o clínico", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await linha(page, "Tumor").getByRole("button", { name: /Isolar uma parte/ }).click();

    const texto = (await page.textContent("#state-idle")).toLowerCase();
    for (const termo of ["boolean", "interseção", "intersecao", "subtração", "malha"]) {
      expect(texto, `jargão visível: ${termo}`).not.toContain(termo);
    }
  });
});

test.describe("envio ao backend", () => {
  test("o POST leva boolean_ops e o GLB volta com as três peças", async ({ page }) => {
    test.skip(!backendUp, COMO_SUBIR);
    // O corpo do POST é multipart com os STLs binários dentro, e o Playwright
    // não retém corpos de upload de arquivo (`postData` vem vazio). Espionar o
    // FormData no próprio fetch mostra o que a página realmente monta — que é
    // onde mora o contrato de API.
    await page.addInitScript(() => {
      window.__boolOps = null;
      const original = window.fetch;
      window.fetch = (entrada, init) => {
        const corpo = init && init.body;
        if (corpo instanceof FormData && corpo.has("boolean_ops")) {
          window.__boolOps = corpo.get("boolean_ops");
        }
        return original(entrada, init);
      };
    });
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await isolar(page, "Tumor", "Rim");

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/upload") && r.request().method() === "POST",
      ),
      page.click("#btn-process"),
    ]);
    expect(resp.status()).toBe(200);

    const enviado = await page.evaluate(() => window.__boolOps);
    expect(JSON.parse(enviado)).toEqual([
      { principal: "Rim.stl", secondary: "Tumor.stl" },
    ]);

    const meshes = (await resp.json()).stats.meshes;
    expect(meshes.map((m) => m.name)).toEqual([
      "Rim",
      "Tumor fora de Rim",
      "Tumor dentro de Rim",
    ]);
    // A prévia da tela prometeu exatamente esses nomes.
    expect(await nomes(page).catch(() => [])).toBeDefined();

    await expect(page.locator("#state-done")).toBeVisible({ timeout: 30_000 });
    expect(await page.inputValue("#viewer-url")).toBeTruthy();
  });

  test("a peça de dentro chega com a cor de destaque", async ({ page }) => {
    test.skip(!backendUp, COMO_SUBIR);
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await isolar(page, "Tumor", "Rim");

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/upload")),
      page.click("#btn-process"),
    ]);
    const meshes = (await resp.json()).stats.meshes;
    expect(meshes.find((m) => m.name.includes("dentro de")).color).toBe("#FFE100");
    // A peça de fora mantém a cor da estrutura de origem (verde de tumor).
    expect(meshes.find((m) => m.name.includes("fora de")).color).toBe("#08E700");
  });

  test("estruturas que não se sobrepõem mostram erro em português", async ({ page }) => {
    test.skip(!backendUp, COMO_SUBIR);
    await abrirUpload(page);
    await escolher(page, [RIM, LONGE]);
    await isolar(page, "Longe", "Rim");
    await page.click("#btn-process");

    await expect(page.locator("#state-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#error-message")).toContainText("não se sobrepõem");
  });
});

test.describe("responsivo", () => {
  test("a lista não estoura a largura em telas estreitas", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await isolar(page, "Tumor", "Rim");

    const estouro = await page.evaluate(
      () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    );
    expect(estouro).toBeLessThanOrEqual(1);
  });

  test("os alvos de toque da linha têm ao menos 36px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    const box = await page
      .getByRole("button", { name: /Isolar uma parte/ })
      .first()
      .boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(36);
  });
});
