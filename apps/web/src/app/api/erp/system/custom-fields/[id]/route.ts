import { forwardErp } from "@/server/bff/erp-proxy"

export async function PUT(request: Request, context: RouteContext<"/api/erp/system/custom-fields/[id]">) {
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ title: "Campo inválido" }, { status: 404 })
  return forwardErp(request, `/system/custom-fields/${id}`)
}
