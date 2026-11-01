import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function GET(request: Request) {
  return forwardFiscal(request, `/manifestations`)
}

export async function POST(request: Request) {
  return forwardFiscal(request, `/manifestations`)
}
