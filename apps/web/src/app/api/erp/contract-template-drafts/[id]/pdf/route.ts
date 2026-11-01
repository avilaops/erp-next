import { contractTemplatesProxy } from "@/server/bff/contracts-proxy"
export async function GET(request: Request, context: RouteContext<"/api/erp/contract-template-drafts/[id]/pdf">) {
  const { id } = await context.params
  return contractTemplatesProxy(request, `/${id}/pdf`)
}
