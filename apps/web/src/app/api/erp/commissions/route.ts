import { forwardErp } from "@/server/bff/erp-proxy"

export async function GET(request: Request) {
  return forwardErp(request, "/commissions")
}
