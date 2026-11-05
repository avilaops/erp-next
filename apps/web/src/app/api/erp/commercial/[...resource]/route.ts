import { forwardErp } from "@/server/bff/erp-proxy"

async function forward(request: Request, { params }: { params: Promise<{ resource: string[] }> }) {
  return forwardErp(request, `/commercial/${(await params).resource.join("/")}`)
}
export const GET = forward
export const POST = forward
export const PUT = forward
