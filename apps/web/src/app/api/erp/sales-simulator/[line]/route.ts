import { forwardErp } from "@/server/bff/erp-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ line: string }> }) {
  return forwardErp(request, `/sales-simulator/${(await params).line}`)
}
