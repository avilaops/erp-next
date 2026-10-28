import { legacyProxy } from "@/lib/legacy-proxy"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return legacyProxy(request, (await context.params).id)
}
