import { forwardErp } from "@/server/bff/erp-proxy"
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return forwardErp(request, `/fixed-expenses/${(await params).id}`)
}
