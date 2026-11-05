import { fileContentProxy } from "@/server/bff/file-content-proxy"
export async function GET(_: Request, context: RouteContext<"/api/erp/system/files/[id]/content">) { const { id } = await context.params; return fileContentProxy(id) }
