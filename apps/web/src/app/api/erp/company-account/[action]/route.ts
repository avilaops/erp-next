import { forwardErp } from "@/lib/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params
  return action === "invoices" ? forwardErp(request, "/company-account/invoices") : Response.json({ title: "Recurso não encontrado" }, { status: 404 })
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params
  return ["checkout", "refresh", "change-plan", "cancel"].includes(action) ? forwardErp(request, `/company-account/${action}`) : Response.json({ title: "Recurso não encontrado" }, { status: 404 })
}
