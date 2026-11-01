"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Download, FileText, RefreshCw, Upload } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { documentHash as hash, fetchReceivedDocument, saveDocument, type ReceivedNote } from "./received-documents"
import { FiscalDistribution } from "./fiscal-distribution"

type Note = ReceivedNote
type Result = Schema<"ReceivedPage">
const initialFilters = { q: "", from: "", to: "" }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const date = (value: string) => new Date(value).toLocaleString("pt-BR")
const maximumBatch = 10

export function ReceivedMonitor() {
  const [result, setResult] = useState<Result | null>(null)
  const [company, setCompany] = useState("")
  const [filters, setFilters] = useState(initialFilters)
  const [query, setQuery] = useState({ ...initialFilters, offset: 0 })
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState("")
  const [selected, setSelected] = useState<number[]>([])
  const activeDownload = useRef<AbortController | null>(null)
  const operation = useRef(false)
  const tenant = useRef("")
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => activeDownload.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({ offset: String(query.offset), limit: "25" })
    for (const key of ["q", "from", "to"] as const) if (query[key]) parameters.set(key, query[key])
    Promise.all([
      erpFetch(`/api/erp/fiscal/received-nfes?${parameters}`, { cache: "no-store", signal: controller.signal }),
      erpFetch("/api/erp/me", { cache: "no-store", signal: controller.signal }),
    ]).then(async ([response, accessResponse]) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Não foi possível carregar as notas recebidas")
      const access = await accessResponse.json()
      if (!accessResponse.ok || access.tenant?.id !== data.tenantId) throw new Error("A empresa da sessão mudou. Atualize o monitor")
      if (controller.signal.aborted) return
      if (tenant.current && tenant.current !== data.tenantId) {
        setFile(null); setNotice("")
        if (fileInput.current) fileInput.current.value = ""
      }
      tenant.current = data.tenantId
      setResult(data); setSelected([]); setCompany(access.tenant.legalName); setError("")
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, refresh])

  async function importXml(event: React.FormEvent) {
    event.preventDefault()
    if (!file || !result?.canImport || operation.current || loading) return
    operation.current = true; setBusy("import"); setError(""); setNotice("")
    try {
      if (!file.size || file.size > 900 * 1024) throw new Error("Selecione um XML de até 900 KiB")
      const bytes = await file.arrayBuffer()
      let xml: string
      try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { throw new Error("Selecione um XML codificado em UTF-8") }
      const body = JSON.stringify({ xml })
      if (new TextEncoder().encode(body).byteLength > 1024 * 1024) throw new Error("O conteúdo do XML excede o limite de envio")
      const response = await erpFetch("/api/erp/fiscal/received-nfes/import", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": result.tenantId }, body,
      })
      const saved: Note & { title?: string } = await response.json()
      if (!response.ok) throw new Error(saved.title || "Não foi possível confirmar a importação; atualize o monitor antes de repetir")
      if (saved.xmlSha256 !== await hash(bytes)) throw new Error("O hash recebido não corresponde ao XML selecionado. Confira o monitor antes de repetir")
      setNotice(response.headers.get("idempotency-replayed") === "true" ? `A NF-e ${saved.number} já estava armazenada. Nenhuma duplicata foi criada.` : `NF-e ${saved.number} importada e armazenada nesta empresa.`)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ""
      setFilters(initialFilters); setLoading(true); setQuery({ ...initialFilters, offset: 0 })
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a importação. Atualize o monitor antes de repetir") }
    finally { operation.current = false; setBusy("") }
  }

  async function download(note: Note, format: "xml" | "danfe") {
    if (!result || operation.current || loading) return
    operation.current = true; setBusy(`${note.id}-${format}`); setError(""); setNotice("")
    const controller = new AbortController()
    activeDownload.current = controller
    try {
      const document = await fetchReceivedDocument(note, result.tenantId, format, controller.signal)
      saveDocument(document.bytes, document.mime, document.filename)
      setNotice(`${format === "xml" ? "XML" : "DANFE"} da NF-e ${note.number} preparado para download.`)
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível baixar o documento") }
    finally { operation.current = false; activeDownload.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  async function downloadBatch() {
    if (!result || operation.current || loading || !selected.length || selected.length > maximumBatch) return
    const notes = result.data.filter(note => selected.includes(note.id))
    if (notes.length !== selected.length) return
    const controller = new AbortController()
    activeDownload.current = controller
    operation.current = true; setError(""); setNotice("")
    let current: Note | undefined
    try {
      const files: Record<string, Uint8Array> = {}
      let size = 0
      for (const [index, note] of notes.entries()) {
        current = note
        setBusy(`Gerando DANFE ${index + 1} de ${notes.length}…`)
        const document = await fetchReceivedDocument(note, result.tenantId, "danfe", controller.signal)
        size += document.bytes.byteLength
        if (size > 32 * 1024 * 1024) throw new Error("O lote excede 32 MiB. Selecione menos notas")
        files[document.filename] = document.bytes
      }
      const { zipSync } = await import("fflate")
      controller.signal.throwIfAborted()
      const archive = new Uint8Array(zipSync(files, { level: 0 }))
      saveDocument(archive, "application/zip", `DANFEs-${new Date().toISOString().slice(0, 10)}.zip`)
      setNotice(`Lote completo: ${notes.length} DANFE(s) no arquivo ZIP.`)
    } catch (reason) {
      if (controller.signal.aborted) setNotice("Geração cancelada. Nenhum lote foi baixado.")
      else setError(`O lote não foi baixado${current ? `: NF-e ${current.number}` : ""}. ${reason instanceof Error ? reason.message : "Não foi possível gerar todos os documentos"}`)
    } finally { operation.current = false; activeDownload.current = null; setBusy("") }
  }

  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div><p className="text-sm text-primary">Fiscal / Notas recebidas</p><h1 className="mt-2 text-3xl font-semibold">Monitor de notas fiscais</h1><p className="mt-2 text-muted-foreground">{company || "Documentos da empresa ativa"}</p></div>
      <Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal">Configurações fiscais</Link>
    </header>
    <FiscalDistribution />
    <section className="form-section space-y-4" aria-labelledby="import-title">
      <h2 id="import-title" className="flex items-center gap-2 text-lg font-semibold"><Upload className="size-5 text-primary" />Importar NF-e recebida</h2>
      <p className="text-sm text-muted-foreground">Escolha o XML completo, com protocolo de autorização, destinado ao CNPJ desta empresa. O arquivo original fica armazenado para consulta e download.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={importXml}>
        <label className="min-w-0 flex-1 space-y-2 text-sm">XML da NF-e<input ref={fileInput} type="file" accept=".xml,application/xml,text/xml" className="block w-full rounded-xl border p-3" disabled={loading || !!busy || !result?.canImport} onChange={event => { setFile(event.target.files?.[0] || null); setNotice(""); setError("") }} /></label>
        <Button type="submit" disabled={!file || loading || !!busy || !result?.canImport}>{busy === "import" ? "Importando XML…" : "Importar XML"}</Button>
      </form>
      <p className="text-xs text-muted-foreground">A importação confere a estrutura e a coerência do protocolo declarado. Não comprova a assinatura digital nem a situação atual na SEFAZ. Compras, estoque e financeiro não são alterados por esta ação.</p>
    </section>
    <section className="form-section space-y-4" aria-labelledby="notes-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="notes-title" className="text-lg font-semibold">Notas armazenadas{result ? ` (${result.total})` : ""}</h2><Button variant="outline" disabled={loading || !!busy} onClick={() => { setLoading(true); setRefresh(value => value + 1) }}><RefreshCw className="size-4" />Atualizar</Button></div>
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_170px_auto]" onSubmit={event => { event.preventDefault(); setLoading(true); setQuery({ ...filters, offset: 0 }) }}>
        <label className="space-y-2 text-sm">Buscar fornecedor, CNPJ, nota ou chave<Input value={filters.q} maxLength={200} onChange={event => setFilters({ ...filters, q: event.target.value })} /></label>
        <label className="space-y-2 text-sm">Emissão de (UTC)<Input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className="space-y-2 text-sm">Emissão até (UTC)<Input type="date" value={filters.to} min={filters.from || undefined} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
        <Button className="self-end" type="submit" disabled={loading || !!busy}>Filtrar</Button>
      </form>
      {result && result.data.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <span className="text-sm">{selected.length} selecionada(s) · até {maximumBatch} por lote</span>
        <Button variant="outline" disabled={loading || !!busy || !selected.length} onClick={() => void downloadBatch()}><Download className="size-4" />Baixar DANFEs selecionados (ZIP)</Button>
        <Button variant="ghost" disabled={loading || !!busy || !selected.length} onClick={() => setSelected([])}>Limpar seleção</Button>
        {busy.startsWith("Gerando DANFE") && <><span role="status" className="text-sm">{busy}</span><Button variant="outline" onClick={() => activeDownload.current?.abort()}>Cancelar lote</Button></>}
      </div>}
      {loading ? <p role="status">Carregando notas da empresa…</p> : result && !result.data.length ? <div className="py-10 text-center"><FileText className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium">Nenhuma nota encontrada</p><p className="mt-1 text-sm text-muted-foreground">Importe um XML recebido ou ajuste os filtros da consulta.</p></div> : result && <div className="space-y-3">{result.data.map(note => <article className="rounded-xl border p-4" key={note.id}>
        <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(note.id)} disabled={loading || !!busy || !selected.includes(note.id) && selected.length >= maximumBatch} onChange={event => setSelected(values => event.target.checked ? [...values, note.id] : values.filter(id => id !== note.id))} />Selecionar NF-e {note.number} para o lote</label>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold"><Link href={`/fiscal/monitor/${note.id}`} className="text-primary underline">NF-e {note.number} · Série {note.series}</Link></h3><p className="mt-1 text-sm">{note.issuerName} · {note.issuerDocument}</p><p className="mt-1 text-xs text-muted-foreground">Emissão: {date(note.issuedAt)} · {note.itemCount} item(ns) · {note.environment === 2 ? "Homologação — sem valor fiscal" : "Ambiente de produção declarado no XML"}</p></div><strong>{money.format(note.totalCents / 100)}</strong></div>
        <p className="mt-3 break-all text-xs text-muted-foreground">Chave: {note.accessKey}</p>
        <div className="mt-4 flex flex-wrap gap-2">{(["xml", "danfe"] as const).map(format => <Button key={format} variant="outline" disabled={!!busy} onClick={() => void download(note, format)}><Download className="size-4" />{busy === `${note.id}-${format}` ? "Preparando…" : format === "xml" ? "Baixar XML" : "Baixar DANFE"}</Button>)}<details className="w-full text-xs text-muted-foreground"><summary className="cursor-pointer py-2">Integridade e recebimento</summary><p className="break-all">SHA-256 do XML: {note.xmlSha256}</p><p className="mt-1">Importado em {date(note.createdAt)}. A situação atual na SEFAZ não foi consultada.</p></details></div>
      </article>)}</div>}
      {result && <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={loading || !!busy || !query.offset} onClick={() => { setLoading(true); setQuery({ ...query, offset: Math.max(0, query.offset - 25) }) }}>Anterior</Button><span className="text-sm">Página {Math.floor(query.offset / 25) + 1}</span><Button variant="outline" disabled={loading || !!busy || query.offset + 25 >= result.total} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset + 25 }) }}>Próxima</Button></div>}
    </section>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-primary/30 p-4 text-sm">{notice}</p>}
    <p className="text-sm text-muted-foreground">A consulta automática à SEFAZ e a conexão do certificado A1 ainda não estão disponíveis neste módulo. <Link className="text-primary underline" href="/fiscal/danfe">Gerar DANFE de outro XML autorizado</Link>.</p>
  </div>
}
