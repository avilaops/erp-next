import { forwardErp } from "@/lib/erp-proxy"
type Context = { params: Promise<{ id: string }> }
export const GET = async (request: Request, { params }: Context) => forwardErp(request, `/products/${(await params).id}`)
export const PUT = async (request: Request, { params }: Context) => forwardErp(request, `/products/${(await params).id}`)
