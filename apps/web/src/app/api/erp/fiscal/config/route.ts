import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export const GET = (request: Request) => forwardFiscal(request, "/config")
export const PUT = (request: Request) => forwardFiscal(request, "/config")
