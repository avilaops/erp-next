import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
if (!server) throw new Error("Registry browser fixture requires the base web server")
export default defineConfig({
  ...base,
  testMatch: ["registry-lookups-ui.spec.ts", "party-cnpj-ui.spec.ts", "ibpt-ui.spec.ts", "order-cnpj-recovery-ui.spec.ts", "cnpj-registration-status-ui.spec.ts"],
  timeout: 45_000,
  use: { ...base.use, launchOptions: process.env.ERP_BROWSER_EXECUTABLE ? { executablePath: process.env.ERP_BROWSER_EXECUTABLE } : undefined },
  webServer: { ...server,
    ...(process.env.ERP_REGISTRY_BROWSER_SERVER ? { command: `node ${process.env.ERP_REGISTRY_BROWSER_SERVER}` } : {}),
    env: { ...server.env, PORT: "33118", HOSTNAME: "127.0.0.1", ERP_API_URL: "http://127.0.0.1:33941" },
  },
})
