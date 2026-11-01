import { forwardErp } from "@/server/bff/erp-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardErp(request, `/orders/${(await params).id}/commission`)
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardErp(request, `/orders/${(await params).id}/commission`)
}
