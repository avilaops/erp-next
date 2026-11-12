"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { RequestError } from "@/components/feedback/session-recovery"
import { DataTable } from "@/components/workspace/data-table"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import { productImportHref, readProductImport, type ProductImport } from "./product-import-model"

function markPending(id: string, pending: boolean) {
  const current = new URL(window.location.href)
  if (current.pathname === "/preferencias/dados/importacao" && current.searchParams.get("job") === id) window.history.replaceState(null, "", productImportHref(id, pending))
}

export function ProductImportJob({ id, tenant, initialPending, canReadCatalog }: { id: string; tenant: string; initialPending: boolean; canReadCatalog: boolean }) {
  const [preview, setPreview] = useState<ProductImport | null>(null)
  const [phase, setPhase] = useState<"" | "loading" | "confirming">("loading")
  const [checked, setChecked] = useState(false)
  const [uncertain, setUncertain] = useState(initialPending)
  const [error, setError] = useState("")
  const [status, setStatus] = useState(0)
  const active = useRef<AbortController | null>(null)
  const live = useRef(false)
  const load = useCallback(() => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    let responseStatus = 0
    erpFetch(`/api/erp/products/import/${id}`, { signal: controller.signal }).then(async response => {
      responseStatus = response.status
      const data = await readProductImport(response, id)
      if (live.current && !controller.signal.aborted) {
        setPreview(data); setChecked(false)
        // A preview can be an older committed version while confirmation is still running.
        if (data.status === "imported") { setUncertain(false); markPending(id, false) }
      }
    }).catch(cause => { if (live.current && !controller.signal.aborted) { setStatus(responseStatus); setError(cause instanceof Error ? cause.message : "Não foi possível conferir o resultado.") } })
      .finally(() => { if (live.current && active.current === controller) { active.current = null; setPhase("") } })
  }, [id])
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; active.current?.abort(); active.current = null } }, [load])
  useNavigationGuard(phase || uncertain ? "Sair antes de conferir o resultado desta importação?" : null)
  function reload() { if (!active.current) { setPhase("loading"); setError(""); setStatus(0); void load() } }
  async function confirm() {
    if (active.current || !checked || !preview?.valid || preview.status !== "previewed") return
    const controller = new AbortController()
    active.current = controller; setPhase("confirming"); setError(""); setStatus(0)
    markPending(id, true)
    let responseStatus = 0
    try {
      const response = await erpFetch(`/api/erp/products/import/${id}/confirm`, { method: "POST", headers: { "X-Tenant-Id": tenant, "Idempotency-Key": id }, signal: controller.signal })
      responseStatus = response.status
      const data = await readProductImport(response, id)
      if (data.status !== "imported") throw Error("O serviço não confirmou a importação. Confira o resultado antes de continuar.")
      if (live.current && !controller.signal.aborted) { setPreview(data); setUncertain(false); markPending(id, false) }
    } catch (cause) {
      if (live.current && !controller.signal.aborted) { const pending = uncertain || responseStatus === 0 || responseStatus >= 500 || responseStatus < 400; setStatus(responseStatus); setError(cause instanceof Error ? cause.message : "Não foi possível conferir a confirmação."); setUncertain(pending); markPending(id, pending) }
    } finally { if (live.current && active.current === controller) { active.current = null; setPhase("") } }
  }
  return <section aria-label="Prévia da importação" className="min-w-0 space-y-3 rounded-lg border bg-card p-3 text-sm">
    {phase && <p role="status">{phase === "loading" ? "Conferindo prévia e resultado…" : "Confirmando importação…"}</p>}
    {error && <p role="alert" className="text-destructive [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"><RequestError message={error} status={status} /></p>}
    {uncertain && <p role="status" className="rounded-md border p-3">Ainda não foi possível confirmar o resultado. Confira o resultado ou repita a confirmação deste mesmo arquivo.</p>}
    {preview && <>
      <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{preview.filename}</h2>
      <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2 text-xs">{[["Válidas", preview.valid], ["Inválidas", preview.invalid], ["Conflitantes", preview.conflicts]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{count}</dd></div>)}</dl>
      {preview.status === "imported" ? <p role="status" className="rounded-md border p-3">{preview.result!.imported} de {preview.result!.total} produto(s) importado(s). Resultado consultável ao reabrir esta página.</p> : <p className="text-xs text-muted-foreground">Somente as linhas válidas e sem conflito serão importadas. SKUs existentes não são substituídos.</p>}
      <div role="region" aria-label="Linhas do arquivo" tabIndex={0} className="max-h-72 overflow-y-auto rounded-md border"><DataTable className="table-fixed"><caption className="sr-only">Prévia das linhas do CSV</caption><thead className="bg-muted/40"><tr><th scope="col" className="w-3/5 p-2">Produto</th><th scope="col" className="p-2">Conferência</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.line} className="border-t align-top"><td className="p-2 [overflow-wrap:anywhere]"><p>{row.input.name}</p><p className="mt-1 text-xs text-muted-foreground">Linha {row.line} · {row.input.sku}</p></td><td className="p-2 text-xs [overflow-wrap:anywhere]">{row.error || (row.conflict ? "SKU conflitante" : "Válida")}{row.error && row.conflict && <p>SKU conflitante</p>}</td></tr>)}</tbody></DataTable></div>
      {preview.status === "previewed" && preview.valid > 0 && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void confirm() }}>
        <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" required checked={checked} disabled={!!phase} onChange={event => setChecked(event.target.checked)} />Conferi a prévia e quero importar as linhas válidas.</label>
        <Button type="submit" disabled={!!phase || !checked}>{phase === "confirming" ? "Confirmando…" : uncertain ? "Repetir confirmação" : "Confirmar importação"}</Button>
      </form>}
    </>}
    <nav aria-label="Ações da importação" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button type="button" variant="outline" disabled={!!phase} onClick={reload}>Conferir resultado</Button>
      {!uncertain && <Link className="inline-flex min-h-11 items-center text-primary underline" href="/preferencias/dados/importacao">Importar outro arquivo</Link>}
      {canReadCatalog && <Link className="inline-flex min-h-11 items-center text-primary underline" href="/cadastros/produtos">Consultar produtos</Link>}
    </nav>
  </section>
}
