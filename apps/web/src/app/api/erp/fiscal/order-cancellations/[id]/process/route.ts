import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardFiscal(request, `/order-cancellations/${(await params).id}/process`)
}
