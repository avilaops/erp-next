import { contractsProxy } from "@/server/bff/contracts-proxy"
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  return contractsProxy(request, `/${id}/files/${file}`)
}
