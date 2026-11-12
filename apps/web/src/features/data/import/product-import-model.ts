export type ProductImportRow = { line: number; input: { sku: string; name: string }; error?: string | null; conflict: boolean }
export type ProductImport = { id: string; filename: string; format: "csv"; status: "previewed" | "imported"; valid: number; invalid: number; conflicts: number; rows: ProductImportRow[]; result: { imported: number; total: number } | null }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function productImportHref(id: string, pending = false) {
  if (!uuid.test(id)) throw Error("O identificador da prévia é inválido.")
  return `/preferencias/dados/importacao?job=${id}${pending ? "&pending=1" : ""}`
}
export async function readProductImportFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".csv") || file.size === 0 || file.size > 2 * 1024 * 1024) throw Error("Selecione um CSV não vazio de até 2 MiB.")
  if (new TextEncoder().encode(file.name).length > 160) throw Error("Use um nome de arquivo CSV mais curto (até 160 bytes).")
  let content: string
  // Preserve a UTF-8 BOM too: the backend supports it and hashes the original content.
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()) } catch { throw Error("Salve o CSV em UTF-8 e selecione o arquivo novamente.") }
  return { filename: file.name, content }
}
export async function readProductImport(response: Response, expectedId?: string): Promise<ProductImport> {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw Error(typeof body?.title === "string" ? body.title : "Não foi possível consultar a importação. Tente novamente.")
  const data = body?.data
  const validRow = (row: ProductImportRow) => row && Number.isInteger(row.line) && row.line >= 2 && typeof row.input?.sku === "string" && typeof row.input?.name === "string" && typeof row.conflict === "boolean" && (row.error == null || typeof row.error === "string" && row.error.length > 0)
  if (!data || typeof data.id !== "string" || !uuid.test(data.id) || expectedId && data.id.toLowerCase() !== expectedId.toLowerCase()
    || typeof data.filename !== "string" || data.format !== "csv" || !["previewed", "imported"].includes(data.status)
    || !Array.isArray(data.rows) || data.rows.length === 0 || data.rows.length > 5000 || !data.rows.every(validRow)
    || new Set(data.rows.map((row: ProductImportRow) => row.line)).size !== data.rows.length
    || data.valid !== data.rows.filter((row: ProductImportRow) => !row.error && !row.conflict).length
    || data.invalid !== data.rows.filter((row: ProductImportRow) => !!row.error).length
    || data.conflicts !== data.rows.filter((row: ProductImportRow) => row.conflict).length
    || data.status === "imported" && (!data.result || !Number.isInteger(data.result.imported) || data.result.imported < 0 || data.result.imported > data.valid || data.result.total !== data.rows.length)) throw Error("O serviço retornou um resultado de importação inválido. Confira a prévia novamente.")
  return data as ProductImport
}
