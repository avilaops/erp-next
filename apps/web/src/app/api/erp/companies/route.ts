import { forwardErp } from "@/lib/erp-proxy"

export const GET = (request: Request) => forwardErp(request, "/companies")
export const POST = (request: Request) => forwardErp(request, "/companies")
