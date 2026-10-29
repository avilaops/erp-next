import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export const GET = (request: Request) => forwardFiscal(request, "/nfe")
export const POST = (request: Request) => forwardFiscal(request, "/nfe")
