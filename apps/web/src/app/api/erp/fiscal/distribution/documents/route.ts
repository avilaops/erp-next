import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export async function GET(request: Request) {
  return forwardFiscal(request, "/distribution/documents")
}
