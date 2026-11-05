import { forwardErp } from "@/lib/api/forward"

export const GET = (request: Request) => forwardErp(request, "/system/label-templates")
export const POST = (request: Request) => forwardErp(request, "/system/label-templates")
