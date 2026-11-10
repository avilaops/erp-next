import { cookies } from "next/headers"
import { cookieName, cookieOptions, currentIdentitySession, erpConfiguration, seal, uuidPattern } from "@/server/auth/erp-session"

async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks).toString("utf8")
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
}

export async function POST(request: Request) {
  const output = { "Cache-Control": "no-store" }
  try {
    const config = erpConfiguration()
    if (request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403, headers: output })
    const session = await currentIdentitySession()
    if (!session) return Response.json({ title: "Entre novamente" }, { status: 401, headers: output })
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    if (contentType !== "application/json") return Response.json({ title: "O pedido precisa ser JSON" }, { status: 415, headers: output })
    const body = await readLimitedBody(request, 1024)
    if (body === null) return Response.json({ title: "Pedido muito grande" }, { status: 413, headers: output })
    let payload: unknown
    try { payload = JSON.parse(body) } catch { return Response.json({ title: "Pedido inválido" }, { status: 400, headers: output }) }
    const { tenantId } = payload && typeof payload === "object" ? payload as { tenantId?: unknown } : {}
    if (typeof tenantId !== "string" || !uuidPattern.test(tenantId)) return Response.json({ title: "Empresa inválida" }, { status: 400, headers: output })
    const access = await fetch(`${config.api}/api/v1/company-selection`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": tenantId } })
    if (access.status !== 204) return Response.json({ title: "Não foi possível selecionar esta empresa" }, { status: [401, 403].includes(access.status) ? access.status : 503, headers: output })
    const remaining = Math.floor((session.expiresAt - Date.now()) / 1000)
    if (remaining <= 0) return Response.json({ title: "Entre novamente" }, { status: 401, headers: output })
    const jar = await cookies()
    jar.set(cookieName("session"), seal({ ...session, tenantId }, "erp-session"), cookieOptions(remaining))
    return Response.json({ tenantId }, { headers: output })
  } catch { return Response.json({ title: "Não foi possível selecionar a empresa" }, { status: 503, headers: output }) }
}
