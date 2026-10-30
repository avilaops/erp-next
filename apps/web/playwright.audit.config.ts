import { defineConfig } from "@playwright/test"
import browser from "./playwright.danfe.config"

export default defineConfig({
  ...browser,
  testMatch: ["frontend-route-audit.spec.ts"],
  timeout: 30 * 60_000,
})
