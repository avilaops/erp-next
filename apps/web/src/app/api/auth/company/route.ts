import { cookies } from "next/headers"
import { cookieName, cookieOptions, currentIdentitySession, erpConfiguration, seal, uuidPattern } from "@/lib/erp-session"

export async function POST(request: Request) {
  const output = { "Cache-Control": "no-store" }
  try {
    const config = erpConfiguration()
    if (request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403, headers: output })
    const session = await currentIdentitySession()
    if (!session) return Response.json({ title: "Entre novamente" }, { status: 401, headers: output })
    const body = await request.text()
    if (Buffer.byteLength(body) > 1024) return Response.json({ title: "Pedido muito grande" }, { status: 413, headers: output })
    const { tenantId } = JSON.parse(body)
    if (typeof tenantId !== "string" || !uuidPattern.test(tenantId)) return Response.json({ title: "Empresa inválida" }, { status: 400, headers: output })
    const access = await fetch(`${config.api}/api/v1/me`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": tenantId } })
    if (!access.ok) return Response.json({ title: "Não foi possível selecionar esta empresa" }, { status: [401, 403].includes(access.status) ? access.status : 503, headers: output })
    const remaining = Math.floor((session.expiresAt - Date.now()) / 1000)
    if (remaining <= 0) return Response.json({ title: "Entre novamente" }, { status: 401, headers: output })
    const jar = await cookies()
    jar.set(cookieName("session"), seal({ ...session, tenantId }, "erp-session"), cookieOptions(remaining))
    return Response.json({ tenantId }, { headers: output })
  } catch { return Response.json({ title: "Não foi possível selecionar a empresa" }, { status: 503, headers: output }) }
}
