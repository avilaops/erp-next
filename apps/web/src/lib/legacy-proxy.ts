import { currentSession, erpConfiguration, uuidPattern } from "@/lib/erp-session"

export async function legacyProxy(request: Request, id?: string) {
  try {
    if (id && !uuidPattern.test(id)) return new Response(null, { status: 404 })
    const session = await currentSession()
    if (!session) return Response.json({ title: "Entre para consultar o histórico" }, { status: 401 })
    const config = erpConfiguration()
    const url = new URL(`${config.api}/api/v1/legacy-history${id ? `/files/${id}` : ""}`)
    if (!id) {
      for (const [key, value] of new URL(request.url).searchParams) {
        if (!["collection", "offset"].includes(key)) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        url.searchParams.set(key, value)
      }
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    })
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
    headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream")
    if (id) headers.set("Content-Disposition", "attachment")
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return Response.json({ title: "Histórico temporariamente indisponível" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
