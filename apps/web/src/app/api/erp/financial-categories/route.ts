import { forwardErp } from "@/lib/erp-proxy"
export async function GET(request: Request) { return forwardErp(request, "/financial-categories") }
export async function POST(request: Request) { return forwardErp(request, "/financial-categories") }
