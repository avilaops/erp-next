import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return forwardFiscal(request, `/monitor/documents/${id}/manifest`)
}
