import { contractWebhookProxy } from "@/lib/contracts-proxy"
export async function POST(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  return contractWebhookProxy(request, (await params).tenant)
}
