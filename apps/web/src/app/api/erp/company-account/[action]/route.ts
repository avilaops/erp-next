import { forwardErp } from "@/lib/erp-proxy"
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params
  return ["checkout", "refresh", "change-plan", "cancel"].includes(action) ? forwardErp(request, `/company-account/${action}`) : Response.json({ title: "Recurso não encontrado" }, { status: 404 })
}
