import { forwardErp } from "@/server/bff/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return forwardErp(request, `/purchase-receipts/${(await params).id}`) }
