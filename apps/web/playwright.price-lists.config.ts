import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"
export default defineConfig({ ...base, testMatch: ["price-lists-ui.spec.ts"] })
