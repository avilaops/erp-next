import { defineConfig } from "@playwright/test"
import { randomUUID } from "node:crypto"
import path from "node:path"

// Public fixture values, restricted to this isolated browser test.
export const origin = "http://127.0.0.1:33118"
export const secret = "danfe-browser-fixture-not-a-real-service-secret"
const runId = process.env.ERP_DANFE_BROWSER_RUN_ID ||= `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`
const directory = path.resolve("../../artifacts/danfe-browser", runId)
const webkit = process.env.ERP_BROWSER_ENGINE === "webkit"

export default defineConfig({
  testDir: "./tests",
  testMatch: ["help-ui.spec.ts", "dashboard-preferences.spec.ts", "danfe-ui.spec.ts", "service-key-ui.spec.ts", "onboarding-ui.spec.ts", "party-complements-ui.spec.ts", "staff-ui.spec.ts", "purchase-ui.spec.ts", "contracts-ui.spec.ts", "navigation-ui.spec.ts", "catalog-navigation-ui.spec.ts", "frontend-controls-ui.spec.ts", "frontend-states-ui.spec.ts", "frontend-models.spec.ts", "frontend-integration-ui.spec.ts"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  metadata: { scope: "Fiscal browser and BFF contracts", authAdapter: "synthetic", apiAdapter: "test_double", runId },
  timeout: 90_000,
  outputDir: path.join(directory, "test-results"),
  reporter: [["list"], ["json", { outputFile: path.join(directory, "report.json") }]],
  use: { baseURL: origin, browserName: webkit ? "webkit" : "chromium", channel: webkit ? undefined : process.env.ERP_BROWSER_CHANNEL, viewport: { width: 1280, height: 900 }, screenshot: "only-on-failure" },
  webServer: {
    command: process.env.ERP_BROWSER_DEV === "1" ? "pnpm dev --hostname 127.0.0.1 --port 33118" : "pnpm start --hostname 127.0.0.1 --port 33118",
    url: `${origin}/entrar`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ERP_WEB_ORIGIN: origin, ERP_API_URL: "http://127.0.0.1:33119", ERP_SESSION_SECRET: secret, AUTH_ISSUER: "http://127.0.0.1:33120", ERP_DEFAULT_TENANT_ID: "99999999-9999-4999-8999-999999999999", ERP_AUTH_CLIENT_ID: "browser-fixture-client", ERP_AUTH_CLIENT_SECRET: "browser-fixture-client-secret" },
  },
})
