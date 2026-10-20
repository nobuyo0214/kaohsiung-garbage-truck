const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./test",
  testMatch: "*.spec.cjs",
  workers: 1,
  use: {
    // Mocked-network regression tests are isolated; pwa.spec explicitly exercises real workers.
    serviceWorkers: "block",
    baseURL: "http://127.0.0.1:4173",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "node scripts/serve.cjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
