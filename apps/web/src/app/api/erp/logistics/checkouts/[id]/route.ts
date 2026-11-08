import { forwardErp } from "@/server/bff/erp-proxy"

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => context.params.then(({ id }) => forwardErp(request, `/logistics/checkouts/${id}`))
