export async function GET() {
  try {
    const response = await fetch(`${process.env.ERP_API_URL || "http://127.0.0.1:8080"}/health/ready`, { cache: "no-store", signal: AbortSignal.timeout(3000) })
    return Response.json({ ok: response.ok, application: "erp-next", commit: process.env.ERP_RELEASE_SHA || "unknown" }, { status: response.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ ok: false, application: "erp-next" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
