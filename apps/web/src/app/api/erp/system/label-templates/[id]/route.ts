import { forwardErp } from "@/lib/api/forward"

export async function PUT(request: Request, context: RouteContext<"/api/erp/system/label-templates/[id]">) {
  const { id } = await context.params
  return forwardErp(request, `/system/label-templates/${id}`)
}
