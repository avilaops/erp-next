import "server-only"
import { currentSession, erpConfiguration } from "@/server/auth/erp-session"

export async function forwardCatalogMedia(request: Request, id: string, mediaId: string) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
  if (![id, mediaId].every(value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) || new URL(request.url).search) return new Response(null, { status: 400, headers })
  const session = await currentSession()
  if (!session) return new Response(null, { status: 401, headers })
  try {
    const upstream = await fetch(`${erpConfiguration().api}/api/v1/products/${id}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000),
    })
    const type = upstream.headers.get("content-type")?.split(";")[0]
    if (!upstream.ok || !type || !["image/png", "image/jpeg", "image/webp"].includes(type)) return new Response(null, { status: upstream.ok ? 502 : upstream.status, headers })
    const reader = upstream.body?.getReader()
    let size = 0
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader?.read()
          if (!result || result.done) { controller.close(); return }
          size += result.value.byteLength
          if (size > 20_000_000) { await reader?.cancel(); controller.error(new Error("Imagem acima do limite")); return }
          controller.enqueue(result.value)
        } catch { controller.error(new Error("Falha ao carregar imagem")) }
      },
      cancel() { return reader?.cancel() },
    })
    return new Response(body, { headers: { ...headers, "Content-Type": type } })
  } catch { return new Response(null, { status: 502, headers }) }
}
