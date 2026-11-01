import { contractTemplatesProxy } from "@/server/bff/contracts-proxy"
async function forward(request: Request, context: RouteContext<"/api/erp/contract-template-drafts/[id]">) {
  const { id } = await context.params
  return contractTemplatesProxy(request, `/${id}`)
}
export const GET = forward
export const POST = forward
