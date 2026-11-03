import { forwardErp } from "@/server/bff/erp-proxy"
export const GET = (request: Request) => forwardErp(request, "/registration-settings/parties")
export const PUT = (request: Request) => forwardErp(request, "/registration-settings/parties")
