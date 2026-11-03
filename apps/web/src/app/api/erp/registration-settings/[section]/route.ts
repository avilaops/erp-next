import { forwardErp } from "@/server/bff/erp-proxy"
async function forward(request: Request, context: RouteContext<"/api/erp/registration-settings/[section]">) {
 const { section } = await context.params
 if (!["products", "parties", "contact-types", "tax-profiles"].includes(section)) return Response.json({ title: "Configuração desconhecida" }, { status: 404 })
 return forwardErp(request, `/registration-settings/${section}`)
}
export const GET = forward
export const PUT = forward
