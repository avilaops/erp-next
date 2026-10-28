import { forwardErp } from "@/lib/erp-proxy"
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, { params }: Context) { return forwardErp(request, `/parties/${(await params).id}`) }
export async function PUT(request: Request, { params }: Context) { return forwardErp(request, `/parties/${(await params).id}`) }
