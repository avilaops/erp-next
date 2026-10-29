import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: ["company-persistence.spec.ts", "access-persistence.spec.ts", "catalog-persistence.spec.ts", "stock-persistence.spec.ts", "party-persistence.spec.ts", "operations-persistence.spec.ts", "reference-persistence.spec.ts", "fiscal-persistence.spec.ts", "certificate-persistence.spec.ts", "nfe-draft-persistence.spec.ts"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202", browserName: "chromium", viewport: { width: 1280, height: 900 }, screenshot: "only-on-failure" },
})
