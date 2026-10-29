import { forwardFiscal } from "@/lib/erp-fiscal-proxy"

export const GET = (request: Request) => forwardFiscal(request, "/readiness")
