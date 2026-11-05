import { forwardErp } from "@/server/bff/erp-proxy"

export async function PUT(request: Request, context: RouteContext<"/api/erp/system/label-templates/[id]">) {
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ title: "Modelo de etiqueta inválido" }, { status: 404 })
  return forwardErp(request, `/system/label-templates/${id}`)
}
