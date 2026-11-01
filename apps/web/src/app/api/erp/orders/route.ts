import { forwardErp } from "@/server/bff/erp-proxy"
export const GET = (request: Request) => forwardErp(request, "/orders")
export const POST = (request: Request) => forwardErp(request, "/orders")
