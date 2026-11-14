import { defineConfig } from "@playwright/test"
import base from "./playwright.danfe.config"
const origin = process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:33126"
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
export default defineConfig({
 ...base,
 testMatch:["core-list-sorting-ui.spec.ts"],
 timeout:60000,
 expect:{timeout:7000},
 use:{...base.use,baseURL:origin,launchOptions:process.env.ERP_BROWSER_EXECUTABLE ? {executablePath:process.env.ERP_BROWSER_EXECUTABLE}:undefined},
 webServer:process.env.ERP_CORE_LIST_EXTERNAL_SERVER === "1" ? undefined : {...server,command:process.env.ERP_CORE_LIST_SERVER ? `node "${process.env.ERP_CORE_LIST_SERVER}"` : "pnpm start --hostname 127.0.0.1 --port 33126",url:`${origin}/entrar`,reuseExistingServer:false,env:{...server?.env,PORT:"33126",HOSTNAME:"127.0.0.1",ERP_WEB_ORIGIN:origin,ERP_API_URL:"http://127.0.0.1:33946"}},
})
