import { forwardMcp } from "@/server/mcp/transport"
export const runtime = "nodejs"
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params
  if (!["register", "token", "revoke"].includes(operation)) return new Response(null, { status: 404 })
  return forwardMcp(request, `/mcp/oauth/${operation}`)
}
export const OPTIONS = POST
