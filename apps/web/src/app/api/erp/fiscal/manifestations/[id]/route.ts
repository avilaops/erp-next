import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardFiscal(request, `/manifestations/${(await params).id}`)
}
