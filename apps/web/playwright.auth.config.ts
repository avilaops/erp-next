import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.danfe.config"

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
if (!server) throw new Error("Auth browser fixture requires the base web server")

export default defineConfig({
  ...base,
  testMatch: ["onboarding-ui.spec.ts"],
  timeout: 90_000,
  projects: [
    {
      name: "auth-desktop",
      use: { ...base.use, browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "auth-mobile",
      use: { ...base.use, browserName: "chromium", ...devices["Pixel 5"] },
    },
  ],
  webServer: server,
})
