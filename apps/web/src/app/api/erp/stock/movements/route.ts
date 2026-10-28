import { forwardErp } from "@/lib/erp-proxy"
export const GET = (request: Request) => forwardErp(request, "/stock/movements")
export const POST = (request: Request) => forwardErp(request, "/stock/movements")
