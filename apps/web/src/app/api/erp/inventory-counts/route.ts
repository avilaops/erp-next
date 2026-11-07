import { forwardErp } from "@/server/bff/erp-proxy"

export const GET = (request: Request) => forwardErp(request, "/inventory-counts")
export const POST = (request: Request) => forwardErp(request, "/inventory-counts")
