import { readFile } from "node:fs/promises"
import path from "node:path"

// Fixed packaged asset, never a user-selected filesystem path or upstream URL.
export async function GET() {
  const source = await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"))
  return new Response(source, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } })
}
