import { contractsProxy } from "@/lib/contracts-proxy"
export const GET = (request: Request) => contractsProxy(request)
export const POST = (request: Request) => contractsProxy(request)
