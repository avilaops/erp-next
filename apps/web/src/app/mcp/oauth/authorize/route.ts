import { showConsent, decideConsent } from "@/server/mcp/consent"
export const runtime = "nodejs"
export const GET = showConsent
export const POST = decideConsent
