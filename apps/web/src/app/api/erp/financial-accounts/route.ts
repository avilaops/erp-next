import { forwardErp } from "@/server/bff/erp-proxy"
export async function GET(request: Request) { return forwardErp(request, "/financial-accounts") }
export async function POST(request: Request) { return forwardErp(request, "/financial-accounts") }
