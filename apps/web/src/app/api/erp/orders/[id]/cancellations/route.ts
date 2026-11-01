import { forwardErp } from "@/lib/erp-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardErp(request, `/orders/${(await params).id}/cancellations`)
}
