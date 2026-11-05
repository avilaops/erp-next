import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request, context: RouteContext<"/api/erp/system/workflows/[id]/[action]">) {
  const { id, action } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["publish", "archive"].includes(action)) return Response.json({ title: "Ação de fluxo inválida" }, { status: 404 })
  return forwardErp(request, `/system/workflows/${id}/${action}`)
}
