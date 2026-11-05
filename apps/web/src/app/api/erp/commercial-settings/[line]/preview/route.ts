import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request, { params }: { params: Promise<{ line: string }> }) {
  return forwardErp(request, `/commercial-settings/${(await params).line}/preview`)
}
