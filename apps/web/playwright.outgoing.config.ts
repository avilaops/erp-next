import base from "./playwright.danfe.config"
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
export default { ...base, testMatch: ["outgoing-nfes-ui.spec.ts", "fiscal-operations-ui.spec.ts", "nfe-reference-ui.spec.ts", "outgoing-import-ui.spec.ts", "nfe-modalities-ui.spec.ts", "nfe-financial-ui.spec.ts"], webServer: { ...server, command: "pnpm dev --hostname 127.0.0.1 --port 33118", url: "http://127.0.0.1:33118/entrar", timeout: 180_000, env: { ...server?.env, ERP_NEXT_DIST_DIR: ".next-outgoing-tests" } } }
