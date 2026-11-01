import { contractTemplatesProxy } from "@/lib/contracts-proxy"
export async function GET(request: Request) {
  return contractTemplatesProxy(request, "/catalog")
}
