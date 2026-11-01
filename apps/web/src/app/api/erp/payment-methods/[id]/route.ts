import { forwardErp } from "@/server/bff/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return forwardErp(request, `/payment-methods/${(await params).id}`) }
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) { return forwardErp(request, `/payment-methods/${(await params).id}`) }
