import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"

export const monitorOrigin = "http://127.0.0.1:33928"
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
export default defineConfig({
  ...base,
  testMatch: ["monitor-ui.spec.ts"],
  use: { ...base.use, baseURL: monitorOrigin },
  webServer: {
    ...server,
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 33928",
    url: `${monitorOrigin}/entrar`,
    env: { ...server?.env, ERP_WEB_ORIGIN: monitorOrigin, ERP_API_URL: "http://127.0.0.1:33929" },
  },
})
