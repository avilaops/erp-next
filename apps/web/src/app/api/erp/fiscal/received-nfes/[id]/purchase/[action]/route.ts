import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!["preview", "match"].includes(action)) return Response.json({ title: "Ação de conciliação inválida" }, { status: 404, headers: { "Cache-Control": "no-store" } })
  return forwardFiscal(request, `/received-nfes/${id}/purchase/${action}`)
}
