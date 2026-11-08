import { forwardErp } from "@/server/bff/erp-proxy"

export const POST = (request: Request, context: { params: Promise<{ id: string; package_id: string }> }) => context.params.then(({ id, package_id }) => forwardErp(request, `/logistics/checkouts/${id}/packages/${package_id}/status`))
