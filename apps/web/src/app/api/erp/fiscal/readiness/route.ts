import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export const GET = (request: Request) => forwardFiscal(request, "/readiness")
