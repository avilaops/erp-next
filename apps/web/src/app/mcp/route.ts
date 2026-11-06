import { forwardMcp } from "@/server/mcp/transport"
export const runtime = "nodejs"
export function POST(request: Request) { return forwardMcp(request, "/mcp") }
export function GET(request: Request) { return forwardMcp(request, "/mcp") }
export function DELETE(request: Request) { return forwardMcp(request, "/mcp") }
export function OPTIONS(request: Request) { return forwardMcp(request, "/mcp") }
