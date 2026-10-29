import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "assistant.spec.ts",
  workers: 1,
  timeout: 360_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202",
    browserName: "chromium",
    channel: process.env.ERP_BROWSER_CHANNEL || "chrome",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
})
