import { contractTemplatesProxy } from "@/lib/contracts-proxy"
export async function POST(request: Request, context: RouteContext<"/api/erp/contract-template-drafts/[id]/publish">) {
  const { id } = await context.params
  return contractTemplatesProxy(request, `/${id}/publish`)
}
