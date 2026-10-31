import { readFile } from "node:fs/promises"
import path from "node:path"

// Public JavaScript asset; no session, tenant data or user-selected paths.
export async function GET() {
  const source = await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"))
  return new Response(source, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } })
}
