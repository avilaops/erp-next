import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  return forwardFiscal(request, `/nfe/${id}/${action}`)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  return forwardFiscal(request, `/nfe/${id}/${action}`)
}
