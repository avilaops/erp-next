import { forwardErp } from "@/server/bff/erp-proxy"
type Context = { params: Promise<{ id: string }> }
export const GET = async (request: Request, context: Context) => forwardErp(request, `/price-lists/${(await context.params).id}`)
export const PUT = async (request: Request, context: Context) => forwardErp(request, `/price-lists/${(await context.params).id}`)
