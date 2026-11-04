import { defineConfig } from "@playwright/test"
import persistenceConfig from "./playwright.company.config"

export default defineConfig({
  ...persistenceConfig,
  testMatch: ["proposals-persistence.spec.ts"],
  timeout: 120_000,
})
