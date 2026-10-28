import { forwardErp } from "@/lib/erp-proxy"

export const GET = (request: Request) => forwardErp(request, "/integrations/service-keys")
export const POST = (request: Request) => forwardErp(request, "/integrations/service-keys")
