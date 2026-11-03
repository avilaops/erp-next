import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return forwardFiscal(request, `/cte-distribution/documents/${id}/inspect`)
}
