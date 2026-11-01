import { legacyProxy } from "@/server/bff/legacy-proxy"
export const GET = (request: Request) => legacyProxy(request)
