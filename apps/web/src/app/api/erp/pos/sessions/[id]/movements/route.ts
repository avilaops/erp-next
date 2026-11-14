import { forwardErp } from "@/server/bff/erp-proxy"
export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return forwardErp(request, `/pos/sessions/${id}/movements`) }
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return forwardErp(request, `/pos/sessions/${id}/movements`) }
