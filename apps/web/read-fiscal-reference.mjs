import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { readFileSync, writeFileSync } from "node:fs"
const pdf = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise
const pages = []
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i)
  const text = await page.getTextContent()
  pages.push(text.items.map(item => item.str).join(" "))
}
writeFileSync(process.argv[3], pages.join("\n\n"))
