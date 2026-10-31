"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { blockerLabels, type FiscalReadiness, type NfeDraft } from "./nfe-draft-model"

export function NfeDrafts() {
  const [rows, setRows] = useState<NfeDraft[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [readiness, setReadiness] = useState<FiscalReadiness | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [pageRequest, setPageRequest] = useState<{ cursor?: string }>({})
  const loadedTenant = useRef("")

  useEffect(() => {
    const controller = new AbortController()
    const next = pageRequest.cursor
    const load = async () => {
    try {
      const responses = await Promise.all([
        fetch(`/api/erp/fiscal/nfe?limit=25${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store", signal: controller.signal }),
        fetch("/api/erp/fiscal/readiness", { cache: "no-store", signal: controller.signal }),
        fetch("/api/erp/me", { cache: "no-store", signal: controller.signal }),
      ])
      const [page, status, me] = await Promise.all(responses.map(response => response.json()))
      if (controller.signal.aborted) return
      for (const [index, response] of responses.entries()) if (!response.ok) throw new Error([page, status, me][index].title || "Não foi possível consultar os rascunhos")
      if (status.tenantId !== me.tenant?.id || page.tenantId !== me.tenant.id) throw new Error("A empresa da sessão mudou. Atualize a página")
      const append = !!next && loadedTenant.current === page.tenantId
      setRows(previous => append ? [...new Map([...previous, ...page.data].map((item: NfeDraft) => [item.id, item])).values()] : page.data)
      loadedTenant.current = page.tenantId
      setCursor(page.nextCursor); setReadiness(status); setCanEdit(me.permissions.includes("fiscal.nfe.manage")); setLoaded(true); setError("")
    } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Falha ao consultar o fiscal"); setRows([]); setReadiness(null); setCanEdit(false); setLoaded(false); setCursor(null) } }
    finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load()
    return () => controller.abort()
  }, [pageRequest])
  const filtered = rows.filter(row => `${row.id} ${row.input.recipient.legalName} ${row.input.recipient.taxId} ${row.input.operationNature}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")))
  return <main className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <Link className="text-sm text-primary underline" href="/fiscal">Voltar ao fiscal</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Notas fiscais de saída</h1><p className="mt-3 text-muted-foreground">Rascunhos de NF-e modelo 55, salvos na empresa ativa para preparação em homologação.</p></div>{canEdit && <Link className={buttonVariants()} href="/fiscal/notas-saida/nova">Preparar nota</Link>}</header>
    <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">Rascunho não é nota autorizada. Não possui número fiscal, chave de acesso, XML ou DANFE. A transmissão à SEFAZ permanece indisponível.</p>
    {readiness && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Preparação para emissão — pendências atuais</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{readiness.blockers.map(blocker => <li key={blocker}>{blockerLabels[blocker] || "Há uma pendência fiscal que exige revisão"}</li>)}</ul><div className="mt-4 flex flex-wrap gap-4 text-sm"><Link className="text-primary underline" href="/preferencias/fiscal">Configuração fiscal</Link><Link className="text-primary underline" href="/preferencias/certificado-digital">Certificado A1</Link></div></details>}
    <section className="form-section space-y-4" aria-label="Rascunhos salvos">
      <div className="flex flex-wrap items-end gap-3"><label className="grid flex-1 gap-2 text-sm">Buscar nos rascunhos carregados<Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Destinatário, CPF/CNPJ ou identificação" /></label><Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setPageRequest({}) }}>Atualizar lista</Button></div>
      {busy && <p role="status">Carregando rascunhos…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loaded && !error && !busy && filtered.length === 0 && <p className="py-6 text-sm text-muted-foreground">{rows.length ? "Nenhum rascunho carregado corresponde à busca." : "Nenhum rascunho cadastrado nesta empresa."}</p>}
      {filtered.map(row => <article key={row.id} className="flex flex-wrap justify-between gap-4 rounded-xl border p-4"><div className="min-w-0"><Link href={`/fiscal/notas-saida/${row.id}`} className="break-words font-medium text-primary underline">{row.input.recipient.legalName}</Link><p className="mt-1 text-sm">{row.input.operationNature} · {row.input.items.length} item(ns)</p><p className="mt-1 break-all text-xs text-muted-foreground">{row.id} · Revisão {row.revision}</p></div><div className="text-sm"><p>Rascunho · Homologação</p><p className="mt-2 font-medium">Produtos: R$ {row.productsTotal.replace(".", ",")}</p></div></article>)}
      {cursor && <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setPageRequest({ cursor }) }}>Carregar mais rascunhos</Button>}
    </section>
  </main>
}
