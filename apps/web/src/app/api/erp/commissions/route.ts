import { forwardErp } from "@/lib/erp-proxy"

export async function GET(request: Request) {
  return forwardErp(request, "/commissions")
}
