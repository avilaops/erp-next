import { forwardErp } from "@/server/bff/erp-proxy"
export async function POST(request: Request, context: RouteContext<"/api/erp/system/files/[id]/archive">) { const { id } = await context.params; return forwardErp(request, `/system/files/${id}/archive`) }
