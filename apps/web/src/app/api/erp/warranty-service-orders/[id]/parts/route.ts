import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardErp(request, `/warranty-service-orders/${(await params).id}/parts`)
}
