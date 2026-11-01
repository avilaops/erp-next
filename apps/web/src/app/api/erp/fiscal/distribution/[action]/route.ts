import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  return forwardFiscal(request, `/distribution/${(await params).action}`)
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  return forwardFiscal(request, `/distribution/${(await params).action}`)
}
