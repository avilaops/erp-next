import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return forwardFiscal(request, `/nfe/${id}`)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return forwardFiscal(request, `/nfe/${id}`)
}
