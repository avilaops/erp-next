import { forwardErp } from "@/server/bff/erp-proxy"
export const GET = (request: Request) => forwardErp(request, "/registration-settings/contact-types")
export const PUT = (request: Request) => forwardErp(request, "/registration-settings/contact-types")
