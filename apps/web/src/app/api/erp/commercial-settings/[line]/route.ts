import { forwardErp } from "@/server/bff/erp-proxy"

export async function GET(request: Request, { params }: { params: Promise<{ line: string }> }) {
  return forwardErp(request, `/commercial-settings/${(await params).line}`)
}

export async function PUT(request: Request, { params }: { params: Promise<{ line: string }> }) {
  return forwardErp(request, `/commercial-settings/${(await params).line}`)
}
