export function productExportQuery(q: string, status: string) {
  const search = q.trim()
  if (Array.from(search).length > 160 || /[\u0000-\u001f\u007f]/.test(search)) throw Error("Use até 160 caracteres na busca, sem caracteres de controle.")
  if (!["", "active", "archived"].includes(status)) throw Error("Escolha uma situação válida para os produtos.")
  const params = new URLSearchParams()
  if (search) params.set("q", search)
  if (status) params.set("status", status)
  return `/api/erp/products/export${params.size ? `?${params}` : ""}`
}

export async function readProductExport(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw Error(typeof data?.title === "string" ? data.title : "Não foi possível gerar o CSV. Tente novamente.")
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") throw Error("O serviço não retornou um arquivo CSV. Tente novamente.")
  const bytes = await response.arrayBuffer()
  let text: string
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { throw Error("O arquivo CSV não está em UTF-8 válido.") }
  const end = text.indexOf("\n")
  const header = (end < 0 ? text : text.slice(0, end)).replace(/\r$/, "")
  if (header !== "sku,name,unit,ncm,cest,base_price,status") throw Error("O arquivo CSV não corresponde ao formato esperado. Tente novamente.")
  return { blob: new Blob([bytes], { type: "text/csv; charset=utf-8" }), empty: end < 0 || !text.slice(end + 1).trim() }
}
