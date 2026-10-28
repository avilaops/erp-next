import { forwardErp } from "@/lib/erp-proxy"
import { uuidPattern } from "@/lib/erp-session"

async function forward(request: Request, context: RouteContext<"/api/erp/users/[id]">) {
  const { id } = await context.params
  if (!uuidPattern.test(id)) return Response.json({ title: "Usuário não encontrado" }, { status: 404 })
  return forwardErp(request, `/users/${id}`)
}
export const GET = forward
export const PUT = forward
