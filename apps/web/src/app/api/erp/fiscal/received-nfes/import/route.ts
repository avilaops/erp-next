import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export const POST = (request: Request) => forwardFiscal(request, "/received-nfes/import")
