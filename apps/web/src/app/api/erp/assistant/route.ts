import { currentSession, erpConfiguration } from "@/lib/erp-session"

const failure = (title: string, status: number) => Response.json({ title }, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  try {
    const config = erpConfiguration()
    const session = await currentSession()
    if (!session) return failure("Entre e selecione uma empresa para usar o assistente.", 401)
    if (request.headers.get("origin") !== config.origin) return failure("Origem não autorizada.", 403)
    if (request.headers.get("x-tenant-id") !== session.tenantId) return failure("A empresa ativa mudou. Recarregue o assistente para iniciar outra conversa.", 409)
    if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("Envie JSON.", 415)
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16_384) { await reader.cancel(); return failure("A conversa excedeu o limite.", 413) }
      chunks.push(value)
    }
    const response = await fetch(`${config.api}/api/v1/assistant`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}`, "X-Tenant-Id": session.tenantId, "Content-Type": "application/json" },
      body: Buffer.concat(chunks), cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(105_000)]),
    })
    // Forward the stream, so browser cancellation closes the Rust response body.
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store", "X-Accel-Buffering": "no",
    } })
  } catch {
    return failure("Não foi possível conectar ao assistente. Tente novamente.", 503)
  }
}
