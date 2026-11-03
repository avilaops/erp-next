import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params
  return forwardFiscal(request, `/cte-distribution/documents/${id}/commercial-links/${linkId}/unlink`)
}
