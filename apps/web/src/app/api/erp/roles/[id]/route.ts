import { forwardErp } from "@/server/bff/erp-proxy"
import { uuidPattern } from "@/server/auth/erp-session"

async function forward(request: Request, context: RouteContext<"/api/erp/roles/[id]">) {
  const { id } = await context.params
  if (!uuidPattern.test(id)) return Response.json({ title: "Papel não encontrado" }, { status: 404 })
  return forwardErp(request, `/roles/${id}`)
}
export const GET = forward
export const PUT = forward
export const DELETE = forward
