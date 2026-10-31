import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardFiscal(request, `/received-nfes/${(await params).id}/purchase`)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardFiscal(request, `/received-nfes/${(await params).id}/purchase`)
}
