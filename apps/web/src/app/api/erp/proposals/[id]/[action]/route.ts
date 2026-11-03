import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!["send", "accept", "reject", "cancel", "revise", "convert"].includes(action)) {
    return Response.json({ title: "Ação de proposta não encontrada" }, { status: 404 })
  }
  return forwardErp(request, `/proposals/${encodeURIComponent(id)}/${action}`)
}
