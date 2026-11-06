import { forwardMcp } from "@/server/mcp/transport"
export async function GET(request: Request, context: { params: Promise<{ document: string[] }> }) {
  const { document } = await context.params
  const name = document.join("/")
  if (!["oauth-protected-resource", "oauth-protected-resource/mcp", "oauth-authorization-server"].includes(name)) return new Response(null, { status: 404 })
  return forwardMcp(request, `/.well-known/${name}`)
}
