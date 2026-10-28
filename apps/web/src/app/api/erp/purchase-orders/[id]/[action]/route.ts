import { forwardErp } from "@/lib/erp-proxy"
const actions = ["confirm", "cancel", "close", "receipts"]
export async function GET(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (action !== "receipts") return Response.json({ title: "Recurso inválido" }, { status: 404 })
  return forwardErp(request, `/purchase-orders/${id}/receipts`)
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!actions.includes(action)) return Response.json({ title: "Recurso inválido" }, { status: 404 })
  return forwardErp(request, `/purchase-orders/${id}/${action}`)
}
