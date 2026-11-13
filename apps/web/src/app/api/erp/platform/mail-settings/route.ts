import { forwardErp } from "@/server/bff/erp-proxy"

export async function GET(request: Request) { return forwardErp(request, "/platform/mail-settings") }
export async function PUT(request: Request) { return forwardErp(request, "/platform/mail-settings") }
