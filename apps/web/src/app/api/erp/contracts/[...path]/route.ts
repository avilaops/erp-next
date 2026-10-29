import { contractsProxy } from "@/lib/contracts-proxy"
type Context = { params: Promise<{ path: string[] }> }
async function forward(request: Request, context: Context) {
  return contractsProxy(request, `/${(await context.params).path.join("/")}`)
}
export const GET = forward
export const POST = forward
