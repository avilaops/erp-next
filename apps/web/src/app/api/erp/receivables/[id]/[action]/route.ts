import { forwardErp } from "@/lib/erp-proxy"
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  return forwardErp(request, `/receivables/${id}/${action}`)
}
