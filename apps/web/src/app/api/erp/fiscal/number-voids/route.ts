import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function POST(request: Request) {
  return forwardFiscal(request, `/number-voids`)
}
