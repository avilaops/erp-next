import { forwardErp } from "@/lib/erp-proxy"
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!["payments", "reverse-payment"].includes(action)) return Response.json({ title: "Recurso inválido" }, { status: 404 })
  return forwardErp(request, `/payables/${id}/${action}`)
}
