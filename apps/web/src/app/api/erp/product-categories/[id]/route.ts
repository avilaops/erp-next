import { forwardErp } from "@/lib/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return forwardErp(request, `/product-categories/${(await params).id}`) }
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) { return forwardErp(request, `/product-categories/${(await params).id}`) }
