import { legacyProxy } from "@/lib/legacy-proxy"
export const GET = (request: Request) => legacyProxy(request)
