"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Download, FileText, RefreshCw, Upload } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Note = {
  id: number; accessKey: string; issuerDocument: string; issuerName: string; recipientDocument: string
  number: number; series: number; issuedAt: string; totalCents: number; itemCount: number
  environment: number; xmlSha256: string; createdAt: string
}
type Result = { tenantId: string; canImport: boolean; data: Note[]; total: number }
const initialFilters = { q: "", from: "", to: "" }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const date = (value: string) => new Date(value).toLocaleString("pt-BR")
async function hash(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

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
  const operation = useRef(false)
  const tenant = useRef("")
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({ offset: String(query.offset), limit: "25" })
    for (const key of ["q", "from", "to"] as const) if (query[key]) parameters.set(key, query[key])
    Promise.all([
      fetch(`/api/erp/fiscal/received-nfes?${parameters}`, { cache: "no-store", signal: controller.signal }),
      fetch("/api/erp/me", { cache: "no-store", signal: controller.signal }),
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
      setResult(data); setCompany(access.tenant.legalName); setError("")
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
      const response = await fetch("/api/erp/fiscal/received-nfes/import", {
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
    operation.current = true; setBusy(`${note.id}-${format}`); setError("")
    try {
      const response = await fetch(`/api/erp/fiscal/received-nfes/${note.id}/${format}`, { cache: "no-store", headers: { "X-Tenant-Id": result.tenantId } })
      if (!response.ok) { const problem = await response.json(); throw new Error(problem.title || "Documento indisponível") }
      const bytes = await response.arrayBuffer()
      const expected = format === "xml" ? note.xmlSha256 : response.headers.get("x-pdf-sha256")
      if (response.headers.get("x-xml-sha256") !== note.xmlSha256 || await hash(bytes) !== expected) throw new Error("O download não corresponde ao documento armazenado")
      const filename = `${format === "xml" ? "NFE" : "DANFE"}-${note.accessKey}.${format === "xml" ? "xml" : "pdf"}`
      const url = URL.createObjectURL(new Blob([bytes], { type: format === "xml" ? "application/xml" : "application/pdf" }))
      const anchor = document.createElement("a")
      anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${format === "xml" ? "XML" : "DANFE"} da NF-e ${note.number} preparado para download.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível baixar o documento") }
    finally { operation.current = false; setBusy("") }
  }

  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div><p className="text-sm text-primary">Fiscal / Notas recebidas</p><h1 className="mt-2 text-3xl font-semibold">Monitor de notas fiscais</h1><p className="mt-2 text-muted-foreground">{company || "Documentos da empresa ativa"}</p></div>
      <Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal">Configurações fiscais</Link>
    </header>
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
      {loading ? <p role="status">Carregando notas da empresa…</p> : result && !result.data.length ? <div className="py-10 text-center"><FileText className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 font-medium">Nenhuma nota encontrada</p><p className="mt-1 text-sm text-muted-foreground">Importe um XML recebido ou ajuste os filtros da consulta.</p></div> : result && <div className="space-y-3">{result.data.map(note => <article className="rounded-xl border p-4" key={note.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">NF-e {note.number} · Série {note.series}</h3><p className="mt-1 text-sm">{note.issuerName} · {note.issuerDocument}</p><p className="mt-1 text-xs text-muted-foreground">Emissão: {date(note.issuedAt)} · {note.itemCount} item(ns) · {note.environment === 2 ? "Homologação — sem valor fiscal" : "Ambiente de produção declarado no XML"}</p></div><strong>{money.format(note.totalCents / 100)}</strong></div>
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
