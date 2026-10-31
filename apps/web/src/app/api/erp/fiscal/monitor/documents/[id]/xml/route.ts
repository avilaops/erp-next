import { forwardFiscal } from "@/lib/erp-fiscal-proxy"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return forwardFiscal(request, `/monitor/documents/${id}/xml`)
}
