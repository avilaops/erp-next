import { forwardFiscal } from "@/server/bff/erp-fiscal-proxy"

type Context = { params: Promise<{ section: string }> }
async function forward(request: Request, context: Context) {
  const { section } = await context.params
  if (!["nfce", "operation-natures", "delivery"].includes(section)) return Response.json({ title: "Configuração fiscal desconhecida" }, { status: 404 })
  return forwardFiscal(request, `/settings/${section}`)
}
export const GET = forward
export const PUT = forward
