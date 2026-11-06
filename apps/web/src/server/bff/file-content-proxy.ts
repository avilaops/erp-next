import "server-only"
import { currentSession, erpConfiguration, uuidPattern } from "@/server/auth/erp-session"

export async function fileContentProxy(id: string) {
  if (!uuidPattern.test(id)) return new Response(null, { status: 404 })
  try {
    const session = await currentSession()
    if (!session) return Response.json({ title: "Entre para consultar os arquivos" }, { status: 401 })
    const config = erpConfiguration()
    const response = await fetch(`${config.api}/api/v1/system/files/${id}/content`, { headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) })
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment", "Content-Type": response.headers.get("content-type") || "application/octet-stream" })
    return new Response(response.body, { status: response.status, headers })
  } catch { return Response.json({ title: "Arquivo temporariamente indisponível" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
