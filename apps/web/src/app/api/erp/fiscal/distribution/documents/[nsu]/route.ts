import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ nsu: string }> }) {
  return forwardFiscal(request, `/distribution/documents/${(await params).nsu}`)
}
