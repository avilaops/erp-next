import { forwardErp } from "@/server/bff/erp-proxy"

export const POST = (request: Request, context: { params: Promise<{ id: string; line: string }> }) => context.params.then(({ id, line }) => forwardErp(request, `/logistics/checkouts/${id}/lines/${line}/check`))
