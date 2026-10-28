import { defineConfig } from "@playwright/test"
import { randomUUID } from "node:crypto"
import path from "node:path"

// Public fixture values, restricted to this isolated browser test.
export const origin = "http://127.0.0.1:33118"
export const secret = "danfe-browser-fixture-not-a-real-service-secret"
const runId = process.env.ERP_DANFE_BROWSER_RUN_ID ||= `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`
const directory = path.resolve("../../artifacts/danfe-browser", runId)

export default defineConfig({
  testDir: "./tests",
  testMatch: "danfe-ui.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  metadata: { scope: "DANFE browser and BFF only", authAdapter: "synthetic", apiAdapter: "test_double", runId },
  timeout: 15_000,
  outputDir: path.join(directory, "test-results"),
  reporter: [["list"], ["json", { outputFile: path.join(directory, "report.json") }]],
  use: { baseURL: origin, browserName: "chromium", channel: process.env.ERP_BROWSER_CHANNEL, viewport: { width: 1280, height: 900 }, screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 33118",
    url: `${origin}/entrar`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: { ERP_WEB_ORIGIN: origin, ERP_API_URL: "http://127.0.0.1:33119", ERP_SESSION_SECRET: secret },
  },
})
