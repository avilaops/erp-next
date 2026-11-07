import { forwardErp } from "@/server/bff/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ line: string }> }) {
  return forwardErp(request, `/commercial/tables/${(await params).line}`)
}
