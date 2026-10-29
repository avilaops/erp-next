import { contractsProxy } from "@/lib/contracts-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return contractsProxy(request, `/${(await params).id}`)
}
