import config from "./playwright.danfe.config"

const origin = "http://127.0.0.1:33190"
process.env.ERP_TEST_API_PORT = "33191"
const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
if (!server) throw new Error("Document browser fixture requires the base web server")
const documentsConfig = {
  ...config,
  metadata: { ...config.metadata, scope: "Order documents, platform SMTP and bank picker" },
  testMatch: ["platform-mail-ui.spec.ts", "order-document-ui.spec.ts", "order-email-ui.spec.ts", "bank-picker-ui.spec.ts"],
  use: { ...config.use, baseURL: origin, browserName: "chromium" as const, channel: "chrome" },
  webServer: {
    ...server,
    command: "pnpm start --hostname 127.0.0.1 --port 33190",
    url: `${origin}/entrar`,
    env: { ...server.env, ERP_NEXT_DIST_DIR: process.env.ERP_DOCUMENT_TEST_DIST || ".next-documents-release", ERP_WEB_ORIGIN: origin, ERP_API_URL: "http://127.0.0.1:33191" },
  },
}

export default documentsConfig
