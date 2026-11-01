import { forwardErp } from "@/server/bff/erp-proxy"

type Context = { params: Promise<{ resource: string[] }> }
export async function GET(request: Request, { params }: Context) {
  return forwardErp(request, `/production/${(await params).resource.join("/")}`)
}
export async function POST(request: Request, { params }: Context) {
  return forwardErp(request, `/production/${(await params).resource.join("/")}`)
}
export async function PUT(request: Request, { params }: Context) {
  return forwardErp(request, `/production/${(await params).resource.join("/")}`)
}
