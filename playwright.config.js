// playwright.config.js
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "list",
  // O projeto "desktop" sobe o viewer inteiro (GLB + WebGL + IBL) por teste, e o
  // render loop do Three.js nunca fica ocioso: cada clique paga a checagem de
  // estabilidade do Playwright. Testes de cor/medição levam 20–36s aqui, contra
  // ~1,5s no projeto "mobile". Com 15s a suíte falhava por tempo, não por bug.
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:5505",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx http-server -p 5505 -c-1 --silent",
    url: "http://127.0.0.1:5505",
    reuseExistingServer: false,
    timeout: 10_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
