import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 5,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3201",
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1024, height: 900 } } }],
  webServer: {
    command: "pnpm start --port 3201",
    url: "http://127.0.0.1:3201",
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
