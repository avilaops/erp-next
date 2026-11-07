import { forwardErp } from "@/server/bff/erp-proxy"

export async function POST(request: Request) {
  return forwardErp(request, "/financial-account-transfers")
}
