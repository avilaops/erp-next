import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params
  if (!["resend", "revoke"].includes(action)) return Response.json({ title: "Ação inválida" }, { status: 404 })
  return forwardErp(request, `/invitations/${id}/${action}`)
}
