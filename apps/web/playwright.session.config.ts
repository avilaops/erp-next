import { defineConfig } from "@playwright/test"

export const origin = "https://erp-session.test"
export const server = "http://127.0.0.1:33128"
export const secret = "session-cookie-browser-fixture-not-a-production-secret"

export default defineConfig({
  testDir: "./tests",
  testMatch: "session-cookies.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: { browserName: "chromium", channel: process.env.ERP_BROWSER_CHANNEL },
  webServer: {
    command: process.env.ERP_BROWSER_DEV === "1" ? "pnpm dev --hostname 127.0.0.1 --port 33128" : "pnpm start --hostname 127.0.0.1 --port 33128",
    url: `${server}/entrar`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ERP_WEB_ORIGIN: origin,
      ERP_SESSION_SECRET: secret,
      ERP_API_URL: "http://127.0.0.1:33129",
      AUTH_ISSUER: "http://127.0.0.1:33130",
      ERP_AUTH_CLIENT_ID: "cookie-fixture-client",
      ERP_AUTH_CLIENT_SECRET: "cookie-fixture-secret",
    },
  },
})
