import { defineConfig } from "@playwright/test"
import frontendConfig from "./playwright.danfe.config"

export default defineConfig({
  ...frontendConfig,
  testMatch: ["proposals-ui.spec.ts"],
  metadata: { ...frontendConfig.metadata, scope: "Propostas comerciais: interface e contratos de comandos" },
})
