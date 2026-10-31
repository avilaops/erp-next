import { forwardErp } from "@/lib/erp-proxy"

type Context = { params: Promise<{ resource: string[] }> }
export async function GET(request: Request, { params }: Context) {
  return forwardErp(request, `/commissions/${(await params).resource.join("/")}`)
}
export async function POST(request: Request, { params }: Context) {
  return forwardErp(request, `/commissions/${(await params).resource.join("/")}`)
}
