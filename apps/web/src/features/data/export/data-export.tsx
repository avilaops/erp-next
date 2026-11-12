"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"
import { productExportQuery, readProductExport } from "./product-export-model"

type Access = { tenant?: { id: string } | null; permissions?: string[] }

export function DataExport() {
  return <Suspense fallback={<main className="p-4" role="status">Conferindo acesso…</main>}><ProductExportForm /></Suspense>
}

function ProductExportForm() {
  const access = useResource<Access>("/api/erp/me")
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [responseStatus, setResponseStatus] = useState(0)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const live = useRef(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const ready = !access.loading && !access.error && !!access.value?.tenant?.id
  const canExport = ready && !!access.value?.permissions?.includes("catalog.products.export")
  const canReadCatalog = ready && !!access.value?.permissions?.includes("catalog.products.read")
  let previewHref: string | null = null
  try { previewHref = productExportQuery(q, status).replace("/api/erp/products/export", "/cadastros/produtos") } catch { /* Invalid filters are explained on submit. */ }

  useEffect(() => {
    live.current = true
    return () => { live.current = false; active.current?.abort(); active.current = null }
  }, [])
  useNavigationGuard(busy ? "Sair antes de concluir o download dos produtos?" : null)

  function clearFeedback() { setError(""); setMessage(""); setResponseStatus(0) }
  function refreshAccess() { if (!active.current) { clearFeedback(); access.reload() } }
  async function download() {
    if (active.current || !canExport) return
    clearFeedback()
    let url: string
    try { url = productExportQuery(q, status) } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confira os filtros.")
      searchInput.current?.focus()
      return
    }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    let requestStatus = 0
    try {
      const response = await erpFetch(url, { signal: controller.signal })
      requestStatus = response.status
      const file = await readProductExport(response)
      if (!live.current || controller.signal.aborted || active.current !== controller) return
      const objectUrl = URL.createObjectURL(file.blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = "produtos.csv"
      document.body.appendChild(anchor)
      try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }
      setMessage(file.empty ? "CSV enviado ao navegador. Nenhum produto corresponde aos filtros; o arquivo contém apenas cabeçalhos." : "CSV enviado ao navegador. Confira o download de produtos.csv.")
    } catch (cause) {
      if (!live.current || active.current !== controller) return
      if (controller.signal.aborted) setMessage("Download cancelado. Os filtros foram preservados.")
      else { setResponseStatus(requestStatus); setError(cause instanceof Error ? cause.message : "Não foi possível gerar o CSV. Tente novamente.") }
    } finally {
      if (live.current && active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  return <main className="mx-auto max-w-4xl space-y-3 p-4 [--workspace-control-height:44px] sm:[--workspace-control-height:36px]">
    <PageHeader title="Exportação de produtos" eyebrow="Preferências / Dados" description="Baixe os produtos da empresa ativa em CSV." />
    <form className="space-y-3 rounded-lg border bg-card p-3" onSubmit={event => { event.preventDefault(); void download() }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Buscar por SKU ou nome<Input ref={searchInput} type="search" maxLength={160} value={q} onChange={event => { setQ(event.target.value); clearFeedback() }} /></label>
        <label className="grid gap-1 text-sm font-medium">Situação<select className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base disabled:opacity-50 sm:h-9 sm:text-sm" value={status} onChange={event => { setStatus(event.target.value); clearFeedback() }}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
      </fieldset>
      {access.loading ? <p role="status" className="text-sm text-muted-foreground">Conferindo acesso…</p> : access.error || !access.value?.tenant?.id ? <div role="alert" className="space-y-2 text-sm [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
        <RequestError message={access.error || "Selecione uma empresa para exportar produtos."} status={access.status} />
        <Button type="button" variant="outline" onClick={refreshAccess}>Conferir acesso</Button>
      </div> : !canExport ? <div className="space-y-2 text-sm"><p>Seu acesso não permite exportar produtos. Solicite a permissão à gestão.</p><Button type="button" variant="outline" onClick={refreshAccess}>Conferir acesso</Button></div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !canExport}>{busy ? "Gerando CSV…" : "Baixar produtos.csv"}</Button>
        {busy && <Button type="button" variant="outline" onClick={() => { active.current?.abort(); setMessage("Download cancelado. Os filtros foram preservados.") }}>Cancelar download</Button>}
      </div>
      {busy && <p role="status" className="text-sm text-muted-foreground">Gerando arquivo com os filtros escolhidos…</p>}
      {error && <div role="alert" className="space-y-2 text-sm text-destructive [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"><RequestError message={error} status={responseStatus} />{[401, 403].includes(responseStatus) && <Button type="button" variant="outline" onClick={refreshAccess}>Conferir acesso</Button>}</div>}
      {message && <p role="status" className="rounded-md border p-3 text-sm">{message}</p>}
      <p className="text-xs text-muted-foreground">CSV UTF-8 com os filtros escolhidos. O navegador recebe o arquivo para você salvar.</p>
      <nav aria-label="Navegação da exportação" className="flex flex-wrap gap-x-4 text-sm">
        {canReadCatalog && previewHref && <Link className="inline-flex min-h-11 items-center text-primary underline" href={previewHref} target="_blank" rel="noopener noreferrer">Conferir produtos no catálogo</Link>}
        <Link className="inline-flex min-h-11 items-center text-primary underline" href="/preferencias?categoria=exportacao">Voltar às preferências</Link>
      </nav>
    </form>
  </main>
}
