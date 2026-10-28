import { forwardErp } from "@/lib/erp-proxy"
import { uuidPattern } from "@/lib/erp-session"
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!uuidPattern.test(id)) return Response.json({ title: "Identificador inválido" }, { status: 400 })
  return forwardErp(request, `/staff/${id}`)
}
export const GET = handle
export const PUT = handle
