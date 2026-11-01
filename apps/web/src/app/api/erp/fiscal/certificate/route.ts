import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export const GET = (request: Request) => forwardFiscal(request, "/certificate")
export const PUT = (request: Request) => forwardFiscal(request, "/certificate")
export const DELETE = (request: Request) => forwardFiscal(request, "/certificate")
