import { erpConfiguration } from "@/lib/erp-session"

export function GET() {
  try { return Response.redirect(new URL("/trocar-senha", erpConfiguration().issuer), 303) }
  catch { return Response.json({ title: "Ávila Auth indisponível neste ambiente" }, { status: 503 }) }
}
