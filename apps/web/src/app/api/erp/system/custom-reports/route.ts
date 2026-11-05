import { forwardErp } from "@/server/bff/erp-proxy"

export const GET = (request: Request) => forwardErp(request, "/system/custom-reports")
export const POST = (request: Request) => forwardErp(request, "/system/custom-reports")
