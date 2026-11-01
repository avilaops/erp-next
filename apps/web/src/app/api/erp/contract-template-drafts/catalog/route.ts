import { contractTemplatesProxy } from "@/server/bff/contracts-proxy"
export async function GET(request: Request) {
  return contractTemplatesProxy(request, "/catalog")
}
