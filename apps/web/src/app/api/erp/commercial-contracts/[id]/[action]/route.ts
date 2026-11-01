import { contractsProxy } from "@/server/bff/contracts-proxy"
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!["review", "send", "sync"].includes(action)) return Response.json({ title: "Ação inválida" }, { status: 404 })
  return contractsProxy(request, `/${id}/${action}`)
}
