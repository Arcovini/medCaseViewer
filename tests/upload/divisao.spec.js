/* Divisão de estruturas na tela de upload: assistente de dois passos, prévia
 * dos nomes e o POST real para o mesh-processor.
 *
 * Precisa do backend local em DRY_RUN na porta 8000. Sem ele os testes que
 * dependem de rede se PULAM (não falham), com a instrução de como subir —
 * `npx playwright test` continua útil para quem não tem o backend em mão.
 * Ver `.context/testar-tudo.sh`, que levanta tudo e roda a suíte inteira.
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
  await expect(page.locator("#file-list li")).toHaveCount(arquivos.length);
}

async function irParaDivisoes(page) {
  await page.click("#btn-continue");
  await expect(page.locator("#bool-section")).toBeVisible();
}

async function definirPar(page, i, referencia, aDividir) {
  const card = page.locator("#bool-list li").nth(i);
  await card.locator("select").nth(0).selectOption(referencia);
  await card.locator("select").nth(1).selectOption(aDividir);
}

test.describe("assistente de dois passos", () => {
  test("passo 2 só existe quando há o que dividir", async ({ page }) => {
    await abrirUpload(page);
    // Nada escolhido: sem trilha, e a ação é processar direto.
    await expect(page.locator("#stepper")).toBeHidden();
    await expect(page.locator("#btn-process")).toBeVisible();

    // Um arquivo só: nada a dividir, segue fluxo de uma tela.
    await escolher(page, [RIM]);
    await expect(page.locator("#stepper")).toBeHidden();
    await expect(page.locator("#btn-continue")).toBeHidden();
    await expect(page.locator("#btn-process")).toBeVisible();

    // Dois STLs: aparece a trilha e o passo 1 passa a avançar.
    await escolher(page, [RIM, TUMOR]);
    await expect(page.locator("#stepper")).toBeVisible();
    await expect(page.locator("#btn-continue")).toBeVisible();
    await expect(page.locator("#btn-process")).toBeHidden();
    await expect(page.locator("#btn-back")).toBeHidden();
  });

  test("avançar mostra a divisão; voltar preserva o que foi configurado", async ({
    page,
  }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await irParaDivisoes(page);

    await expect(page.locator("#step-files")).toBeHidden();
    await expect(page.locator("#btn-back")).toBeVisible();
    await expect(page.locator("#btn-process")).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText("Divis");

    await page.click("#btn-add-bool");
    await expect(page.locator("#bool-list li")).toHaveCount(1);

    await page.click("#btn-back");
    await expect(page.locator("#step-files")).toBeVisible();
    await page.click("#btn-continue");
    await expect(page.locator("#bool-list li")).toHaveCount(1);
  });

  test("seleção que deixa de ser divisível volta ao passo 1", async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await irParaDivisoes(page);

    await escolher(page, [RIM]); // um arquivo só: não há divisão possível
    await expect(page.locator("#bool-section")).toBeHidden();
    await expect(page.locator("#step-files")).toBeVisible();
  });
});

test.describe("configuração da divisão", () => {
  test.beforeEach(async ({ page }) => {
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR, COLUNA]);
    await irParaDivisoes(page);
  });

  test("estado vazio convida a escolher as estruturas", async ({ page }) => {
    await expect(page.locator("#bool-list li")).toHaveCount(0);
    await expect(page.locator("#btn-add-bool-label")).toHaveText(
      "Escolher estruturas para dividir",
    );
    await page.click("#btn-add-bool");
    await expect(page.locator("#btn-add-bool-label")).toHaveText(
      "Adicionar outra divisão",
    );
  });

  test("os chips mostram os nomes finais das peças", async ({ page }) => {
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");
    const chips = page.locator("#bool-list li").first().locator(".struct-tag");
    await expect(chips.nth(0)).toHaveText("Rim · fica inteira");
    await expect(chips.nth(1)).toHaveText("Tumor fora de Rim");
    await expect(chips.nth(2)).toHaveText("Tumor dentro de Rim · destaque");
  });

  test("divisões encadeadas compõem o nome na prévia", async ({ page }) => {
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");
    await page.click("#btn-add-bool");
    await definirPar(page, 1, "Coluna.stl", "Tumor.stl");

    // O tumor já virou "Tumor fora de Rim" na primeira divisão: a segunda
    // precisa partir desse nome, não do nome do arquivo.
    const chips = page.locator("#bool-list li").nth(1).locator(".struct-tag");
    await expect(chips.nth(1)).toHaveText("Tumor fora de Rim fora de Coluna");
    await expect(chips.nth(2)).toHaveText(
      "Tumor fora de Rim dentro de Coluna · destaque",
    );
  });

  test("divisão repetida bloqueia o processar e o aviso some ao remover", async ({
    page,
  }) => {
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");
    await page.click("#btn-add-bool");
    await definirPar(page, 1, "Rim.stl", "Tumor.stl");

    await expect(page.locator("#bool-warning")).toBeVisible();
    await expect(page.locator("#btn-process")).toBeDisabled();

    await page
      .locator("#bool-list li")
      .nth(1)
      .locator('button[aria-label^="Remover a divisão"]')
      .click();
    await expect(page.locator("#bool-warning")).toBeHidden();
    await expect(page.locator("#btn-process")).toBeEnabled();
  });

  test("a estrutura a dividir nunca pode ser a própria referência", async ({
    page,
  }) => {
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");
    const opcoes = await page
      .locator("#bool-list li select")
      .nth(1)
      .locator("option")
      .evaluateAll((els) => els.map((e) => e.value));
    expect(opcoes).not.toContain("Rim.stl");
  });

  test("nenhum jargão de geometria aparece para o clínico", async ({ page }) => {
    await page.click("#btn-add-bool");
    const texto = (await page.textContent("#bool-section")).toLowerCase();
    for (const termo of ["boolean", "interseção", "intersecao", "subtração", "malha"]) {
      expect(texto, `jargão visível: ${termo}`).not.toContain(termo);
    }
  });

  test("selects têm indicação de foco visível", async ({ page }) => {
    await page.click("#btn-add-bool");
    const sel = page.locator("#bool-list li select").first();
    await sel.focus();
    const foco = await sel.evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(foco.shadow !== "none" || foco.outline !== "none").toBe(true);
  });
});

test.describe("envio ao backend", () => {
  test("o POST leva boolean_ops e o GLB volta com as três peças", async ({ page }) => {
    test.skip(!backendUp, COMO_SUBIR);
    // O corpo do POST é multipart com os STLs binários dentro, e o Playwright
    // não retém corpos de upload de arquivo (`postData`/`postDataBuffer` vêm
    // vazios). Espionar o FormData no próprio fetch mostra o que a página
    // realmente monta — que é onde mora o contrato de API.
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
    await irParaDivisoes(page);
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");

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

    const nomes = (await resp.json()).stats.meshes.map((m) => m.name);
    expect(nomes).toEqual(["Rim", "Tumor fora de Rim", "Tumor dentro de Rim"]);

    await expect(page.locator("#state-done")).toBeVisible({ timeout: 30_000 });
    expect(await page.inputValue("#viewer-url")).toBeTruthy();
  });

  test("a peça de dentro chega com a cor de destaque", async ({ page }) => {
    test.skip(!backendUp, COMO_SUBIR);
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await irParaDivisoes(page);
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Tumor.stl");

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
    await irParaDivisoes(page);
    await page.click("#btn-add-bool");
    await definirPar(page, 0, "Rim.stl", "Longe.stl");
    await page.click("#btn-process");

    await expect(page.locator("#state-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#error-message")).toContainText("não se sobrepõem");
  });
});

test.describe("responsivo", () => {
  test("a divisão não estoura a largura em telas estreitas", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await abrirUpload(page);
    await escolher(page, [RIM, TUMOR]);
    await irParaDivisoes(page);
    await page.click("#btn-add-bool");

    const estouro = await page.evaluate(
      () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    );
    expect(estouro).toBeLessThanOrEqual(1);
  });
});
