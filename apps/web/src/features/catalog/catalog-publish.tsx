"use client"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"

type Preview = { tenantId: string; previewHash: string; canEdit: boolean; configured: boolean; products: { code: string; nome: string; colecao: string }[]; publication: { sequence: number } | null }
export function CatalogPublish() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const key = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  async function inspect() {
    setBusy(true); setMessage("")
    try { const response = await erpFetch("/api/erp/catalog-publication"); const data = await response.json(); if (!response.ok) throw new Error(data.title); setPreview(data); key.current = null; setPending(false) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Prévia indisponível") }
    finally { setBusy(false) }
  }
  async function publish() {
    if (!preview) return
    setBusy(true); setPending(true); key.current ||= crypto.randomUUID()
    try { const response = await erpFetch("/api/erp/catalog-publication", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": preview.tenantId, "Idempotency-Key": key.current }, body: JSON.stringify({ previewHash: preview.previewHash }) }); const data = await response.json(); if (!response.ok) throw new Error(data.title); setMessage(`Versão ${data.sequence} publicada no site.`); key.current = null; setPending(false); setPreview(null) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Publicação pendente. Repita para conferir.") }
    finally { setBusy(false) }
  }
  return <section className="mb-5 space-y-3 rounded-xl border p-4" aria-label="Publicação do catálogo">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Catálogo público</h2><p className="text-sm text-muted-foreground">Publique as apresentações revisadas. Preços e dados internos ficam no ERP.</p></div><Button variant="outline" disabled={busy} onClick={inspect}>Revisar publicação</Button></div>
    {preview && <div className="space-y-3"><p>{preview.products.length} equipamentos · {preview.products.filter(p => p.colecao === "core").length} Core · {preview.products.filter(p => p.colecao === "premium").length} Premium</p><details><summary>Conferir equipamentos</summary><ul className="max-h-64 overflow-auto text-sm">{preview.products.map(p => <li key={p.code}>{p.code} · {p.nome} · {p.colecao}</li>)}</ul></details><div className="flex flex-wrap gap-3"><Button disabled={busy || !preview.canEdit || !preview.configured || !preview.products.length} onClick={publish}>{pending ? "Conferir publicação pendente" : "Publicar dados no site"}</Button><Button variant="outline" onClick={() => { const blob = new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "catalogo-ludus.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Exportar para catálogo</Button></div>{!preview.configured && <p>Publicação não configurada para esta empresa.</p>}<p className="text-sm text-muted-foreground">Esta ação publica dados e imagens do site. A edição em PDF é gerada separadamente a partir da exportação revisada.</p></div>}
    {message && <p role="status">{message}</p>}
  </section>
}
