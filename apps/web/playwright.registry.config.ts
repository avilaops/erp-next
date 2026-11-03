import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
if (!server) throw new Error("Registry browser fixture requires the base web server")
export default defineConfig({
  ...base,
  testMatch: ["registry-lookups-ui.spec.ts"],
  timeout: 45_000,
  webServer: {
    ...server,
    env: { ...server.env, ERP_API_URL: "http://127.0.0.1:33941" },
  },
})
