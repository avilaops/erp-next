import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:33130"
const port = new URL(origin).port || "33130"
const upstreamPort = process.env.ERP_FISCAL_POS_UPSTREAM_PORT || "33950"
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer

export default defineConfig({
  ...base,
  testMatch: ["fiscal-pos-list-sorting-ui.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { ...base.use, baseURL: origin, launchOptions: process.env.ERP_BROWSER_EXECUTABLE ? { executablePath: process.env.ERP_BROWSER_EXECUTABLE } : undefined },
  webServer: process.env.ERP_FISCAL_POS_EXTERNAL_SERVER === "1" ? undefined : {
    ...server,
    command: process.env.ERP_FISCAL_POS_SERVER ? `node "${process.env.ERP_FISCAL_POS_SERVER}"` : `pnpm start --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/entrar`,
    reuseExistingServer: false,
    env: { ...server?.env, PORT: port, HOSTNAME: "127.0.0.1", ERP_WEB_ORIGIN: origin, ERP_API_URL: `http://127.0.0.1:${upstreamPort}` },
  },
})
