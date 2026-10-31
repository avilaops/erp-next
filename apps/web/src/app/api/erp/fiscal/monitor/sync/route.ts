import { forwardFiscal } from "@/lib/erp-fiscal-proxy"
export const POST = (request: Request) => forwardFiscal(request, "/monitor/sync")
