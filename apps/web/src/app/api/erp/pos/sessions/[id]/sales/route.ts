import { forwardErp } from "@/server/bff/erp-proxy"
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return forwardErp(request, `/pos/sessions/${id}/sales`) }
