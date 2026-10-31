import { forwardErp } from "@/lib/erp-proxy"

export const GET = (request: Request) => forwardErp(request, "/preferences")
export const PUT = (request: Request) => forwardErp(request, "/preferences")
