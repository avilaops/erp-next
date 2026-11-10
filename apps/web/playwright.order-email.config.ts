import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"

const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:33185"
const baseServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer

export default defineConfig({
  ...base,
  testMatch: ["order-email-ui.spec.ts"],
  webServer: {
    ...baseServer,
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 33185",
    url: `${origin}/entrar`,
    timeout: 180_000,
    env: { ...baseServer?.env, ERP_WEB_ORIGIN: origin, ERP_NEXT_DIST_DIR: ".next-order-email" },
  },
  use: { ...base.use, baseURL: origin },
})
