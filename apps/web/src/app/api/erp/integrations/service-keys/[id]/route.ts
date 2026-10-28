import { forwardErp } from "@/lib/erp-proxy"
import { uuidPattern } from "@/lib/erp-session"

export async function DELETE(request: Request, context: RouteContext<"/api/erp/integrations/service-keys/[id]">) {
  const { id } = await context.params
  if (!uuidPattern.test(id)) return Response.json({ title: "Chave de serviço não encontrada" }, { status: 404, headers: { "Cache-Control": "no-store" } })
  return forwardErp(request, `/integrations/service-keys/${id}`)
}
