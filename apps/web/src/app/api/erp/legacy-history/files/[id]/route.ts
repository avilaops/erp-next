import { legacyProxy } from "@/server/bff/legacy-proxy"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return legacyProxy(request, (await context.params).id)
}
