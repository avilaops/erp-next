import { forwardErp } from "@/server/bff/erp-proxy"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Context) {
  return forwardErp(request, `/orders/${(await params).id}/email`)
}

export async function POST(request: Request, { params }: Context) {
  return forwardErp(request, `/orders/${(await params).id}/email`)
}
