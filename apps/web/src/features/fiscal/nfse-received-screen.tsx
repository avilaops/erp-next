"use client"
import { PageTitle } from "@/components/workspace/page-title"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import { saveDocument } from "./received-documents"
import { decodeNfseBytes, nfseMoney, type ReceivedNfse, type ReceivedNfsePage } from "./nfse-received-model"
import { importNfse, readNfseDetail, readNfsePage, readNfseXml } from "./nfse-received-documents"

type SelectedFile = { name: string; tenantId: string; xml: string; xmlSha256: string; key: string }

async function activeCompany(signal: AbortSignal) {
  const response = await erpFetch("/api/erp/me", { signal })
  const access = await response.json()
  if (!response.ok) throw new Error(access.title || "Entre para consultar os documentos da empresa")
  if (typeof access.tenant?.id !== "string" || typeof access.tenant?.legalName !== "string") throw new Error("Selecione uma empresa antes de consultar NFS-e")
  return { id: access.tenant.id as string, name: access.tenant.legalName as string }
}

export function NfseReceivedScreen() {
  const [view, setView] = useState<ReceivedNfsePage | null>(null)
  const [company, setCompany] = useState("")
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [detail, setDetail] = useState<ReceivedNfse | null>(null)
  const candidate = useRef<SelectedFile | null>(null)
  const operation = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const readCompany = useCallback(async (signal: AbortSignal, expectedId?: string) => {
    try {
      const active = await activeCompany(signal)
      signal.throwIfAborted()
      if (candidate.current && candidate.current.tenantId !== active.id) { candidate.current = null; setSelected(null) }
      if (expectedId && active.id !== expectedId) throw new Error("A empresa da sessão mudou. Atualize os arquivos antes de continuar")
      return active
    } catch (reason) {
      if (!signal.aborted) { setView(null); setCompany(""); setDetail(null) }
      throw reason
    }
  }, [])

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const active = await readCompany(controller.signal)
      const page = await readNfsePage(active.id, offset, controller.signal)
      const current = await readCompany(controller.signal, active.id)
      if (!controller.signal.aborted) {
        setView(page); setCompany(current.name); setError("")
      }
    }
    void load().catch(reason => {
      if (!controller.signal.aborted) { setView(null); setCompany(""); setDetail(null); setError(reason instanceof Error ? reason.message : "Não foi possível consultar NFS-e") }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, refresh, readCompany])

  function reload(nextOffset = offset) {
    if (loading || operation.current) return
    setView(null); setCompany(""); setDetail(null); setError(""); setNotice(""); setLoading(true)
    setOffset(nextOffset); setRefresh(value => value + 1)
  }

  function failed(reason: unknown) {
    setView(null); setCompany(""); setDetail(null); setNotice("")
    setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a operação. Atualize os arquivos antes de reenviar")
  }

  async function choose(file?: File) {
    if (!view || loading || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy("select"); setError(""); setNotice("")
    const previous = candidate.current
    candidate.current = null; setSelected(null)
    try {
      if (!file || file.size > 1_048_576) throw new Error("Selecione um XML nacional de até 1 MiB")
      const decoded = await decodeNfseBytes(await file.arrayBuffer())
      await readCompany(controller.signal, view.tenantId)
      controller.signal.throwIfAborted()
      const value = { ...decoded, name: file.name, tenantId: view.tenantId, key: previous?.tenantId === view.tenantId && previous.xmlSha256 === decoded.xmlSha256 ? previous.key : crypto.randomUUID() }
      candidate.current = value; setSelected(value)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível ler o XML")
    } finally { operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  async function submit() {
    if (!view?.canImport || !selected || selected.tenantId !== view.tenantId || loading || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy("import"); setError(""); setNotice(""); setDetail(null)
    try {
      await importNfse(selected, view.tenantId, controller.signal)
      await readCompany(controller.signal, view.tenantId)
      controller.signal.throwIfAborted()
      candidate.current = null; setSelected(null)
      if (fileInput.current) fileInput.current.value = ""
      setView(null); setCompany(""); setLoading(true); setOffset(0); setRefresh(value => value + 1)
      setNotice("XML nacional importado. Assinatura e situação atual permanecem pendentes de conferência.")
    } catch (reason) { if (!controller.signal.aborted) failed(reason) }
    finally { operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  async function inspect(document: ReceivedNfse, action: "xml" | "detail") {
    if (!view || loading || operation.current) return
    if (action === "detail" && detail?.id === document.id) { setDetail(null); return }
    const controller = new AbortController()
    operation.current = controller
    setBusy(`${document.id}-${action}`); setError(""); setNotice("")
    try {
      if (action === "xml") {
        const bytes = await readNfseXml(document, view.tenantId, controller.signal)
        await readCompany(controller.signal, view.tenantId)
        controller.signal.throwIfAborted()
        saveDocument(bytes, "application/xml", `NFSE-${document.document.accessKey}.xml`)
        setNotice("XML original preparado para download. A assinatura e a situação atual permanecem pendentes de conferência.")
      } else {
        const data = await readNfseDetail(document, view.tenantId, controller.signal)
        await readCompany(controller.signal, view.tenantId)
        controller.signal.throwIfAborted()
        setDetail(data)
      }
    } catch (reason) { if (!controller.signal.aborted) failed(reason) }
    finally { operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div className="min-w-0"><p className="text-sm text-primary">Fiscal / NFS-e</p><PageTitle className="mt-2 text-3xl font-semibold">NFS-e recebidas</PageTitle><p className="mt-2 break-words text-muted-foreground">{company || "Documentos da empresa ativa"}</p></div>
      <Link className={buttonVariants({ variant: "outline" })} href="/fiscal">Abrir central fiscal</Link>
    </header>
    <section className="form-section space-y-3" aria-labelledby="nfse-source">
      <h2 id="nfse-source" className="text-lg font-semibold">Importação manual de XML nacional</h2>
      <p className="text-sm text-muted-foreground">Consulte arquivos de NFS-e em que esta empresa é tomadora do serviço. O ambiente mostrado pertence ao XML importado. Atualizar a lista não consulta a autoridade fiscal.</p>
      <p className="text-sm">Assinatura e situação atual não verificadas</p>
      <p className="text-sm text-muted-foreground">A importação conserva o arquivo e seus dados. A conferência fiscal individual permanece pendente; nenhum lançamento comercial, contábil ou financeiro é criado.</p>
    </section>
    <section className="form-section min-w-0 space-y-4" aria-labelledby="nfse-files">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="nfse-files" className="text-lg font-semibold">Arquivos armazenados{view ? ` (${view.total})` : ""}</h2><Button variant="outline" disabled={loading || !!busy} onClick={() => reload()}>Atualizar arquivos</Button></div>
      {loading && <p role="status" className="text-sm">Carregando NFS-e…</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="break-words text-sm">{notice}</p>}
      {view?.canImport && <div className="space-y-3 rounded-xl border p-4">
        <label htmlFor="nfse-file" className="block text-sm font-medium">XML nacional de NFS-e</label>
        <input ref={fileInput} id="nfse-file" type="file" accept=".xml,application/xml,text/xml" disabled={loading || !!busy} className="block w-full min-w-0 rounded-lg border p-2 text-sm" onChange={event => void choose(event.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">UTF-8, até 1 MiB. O tomador deve ser o CNPJ da empresa. Se a resposta falhar, atualize os arquivos antes de reenviar o mesmo XML.</p>
        {selected && <p className="break-all text-sm">Arquivo selecionado: {selected.name}</p>}
        <Button disabled={loading || !!busy || !selected} onClick={() => void submit()}>{busy === "import" ? "Importando XML…" : "Importar XML"}</Button>
      </div>}
      {view && <>
        {!view.data.length && <p className="text-sm">{view.total ? "Nenhum arquivo nesta página. Volte aos arquivos anteriores." : "Nenhuma NFS-e importada nesta empresa."}</p>}
        {view.data.map(document => <article key={document.id} aria-label={`NFS-e ${document.document.number}`} className="min-w-0 space-y-3 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">NFS-e {document.document.number}</h3><p className="break-words">{document.document.provider.name || document.document.provider.value}</p><p className="mt-1 text-xs text-muted-foreground">{document.document.environment === "homologation" ? "Homologação — sem valor fiscal" : "Ambiente de produção declarado no XML"} · XML nacional importado</p></div><strong>{nfseMoney(document.document.netCents)}</strong></div>
          <p className="break-all text-muted-foreground">Chave: {document.document.accessKey}</p>
          <p className="text-xs text-muted-foreground">Tomador: {document.companyTaxId} · Emissão: {new Date(document.document.issuedAt).toLocaleString("pt-BR")}</p>
          <p className="break-all text-xs text-muted-foreground">SHA-256: {document.document.xmlSha256}</p>
          <p className="text-xs text-muted-foreground">{document.document.verification.layout === "local_profile_valid" ? "Leiaute 1.01 conferido com perfil local de série; conferência fiscal pendente." : "Leiaute 1.00 conferido; conferência fiscal pendente."}</p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || !!busy} onClick={() => void inspect(document, "detail")}>{detail?.id === document.id ? "Ocultar dados do serviço" : "Ver dados do serviço"}</Button><Button variant="outline" disabled={loading || !!busy} onClick={() => void inspect(document, "xml")}>Baixar XML original</Button></div>
          {detail?.id === document.id && <dl className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-muted-foreground">Emitente</dt><dd className="break-words">{detail.document.issuer.name || "Sem nome no XML"}</dd><dd className="break-all">{detail.document.issuer.kind}: {detail.document.issuer.value}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">Prestador</dt><dd className="break-words">{detail.document.provider.name || "Sem nome no XML"}</dd><dd className="break-all">{detail.document.provider.kind}: {detail.document.provider.value}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">Tomador</dt><dd className="break-words">{detail.document.recipient.name || "Sem nome no XML"}</dd><dd className="break-all">CNPJ: {detail.document.recipient.value}</dd></div>
            <div><dt className="text-muted-foreground">Serviço / município</dt><dd>{detail.document.serviceCode} / {detail.document.municipalityCode}</dd></div>
            <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Descrição do serviço</dt><dd className="whitespace-pre-wrap break-words">{detail.document.description}</dd></div>
            <div><dt className="text-muted-foreground">Valor do serviço</dt><dd>{nfseMoney(detail.document.serviceCents)}</dd></div><div><dt className="text-muted-foreground">Valor líquido no XML</dt><dd>{nfseMoney(detail.document.netCents)}</dd></div>
          </dl>}
        </article>)}
        {(view.total > 25 || offset > 0) && <nav aria-label="Páginas de NFS-e" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={loading || !!busy || !offset} onClick={() => reload(Math.max(0, offset - 25))}>Arquivos anteriores</Button><span className="text-sm">{view.data.length ? `${offset + 1}–${offset + view.data.length} de ${view.total}` : `0 de ${view.total}`}</span><Button variant="outline" disabled={loading || !!busy || offset + 25 >= view.total} onClick={() => reload(offset + 25)}>Próximos arquivos</Button></nav>}
      </>}
    </section>
  </div>
}
