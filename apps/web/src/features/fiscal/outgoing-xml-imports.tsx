"use client"

import { Pagination } from "@/components/workspace/pagination"
import Link from "next/link"
import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, EntityListPage, FilterField, ResponsiveTable, SearchToolbar, SortableTableHeader, StatusBadge } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { erpFetch } from "@/lib/api/client"
import { documentHash, saveDocument } from "./received-documents"
import { activeCompany, companyChanged, fetchOutgoingXmlDocument, parseOutgoingXmlNote, readJson, type OutgoingXmlNote } from "./outgoing-xml-documents"

type Loaded = { tenantId: string; notes: OutgoingXmlNote[]; canImport: boolean; total: number }
const base = "/api/erp/fiscal/outgoing-imports"
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const date = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
const cell = "px-4 py-3 text-left align-top"
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Operação fiscal indisponível"

export function OutgoingXmlImports({ id }: { id?: string }) {
  return <Suspense fallback={<p role="status">Carregando documentos da empresa…</p>}><OutgoingXmlImportContent id={id} /></Suspense>
}

function OutgoingXmlImportContent({ id }: { id?: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const table = useTableSort(["number", "recipientName", "issuedAt", "totalCents", "environment"], { by: "", order: "desc" })
  const sortQuery = table.query.toString()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const rawOffset = Number(params.get("offset") || 0)
  const filters = { q: params.get("q") || "", from: params.get("from") || "", to: params.get("to") || "", offset: Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0 }
  const { q, from, to, offset } = filters
  function updateFilters(values: Record<string, string | number>) {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(values)) { if (value !== "" && value !== 0) next.set(key, String(value)); else next.delete(key) }
    router.push(`${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`, { scroll: false })
  }
  const [imported, setImported] = useState<OutgoingXmlNote | null>(null)
  const operation = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setLoaded(null); setError(""); setFile(null); setInputKey(key => key + 1)
      try {
        if (id !== undefined && !/^[1-9]\d*$/.test(id)) throw new Error("Identificador da nota inválido")
        const tenant = await activeCompany(controller.signal)
        const query = new URLSearchParams(sortQuery)
        query.set("q", q); query.set("offset", String(offset)); query.set("limit", "25")
        if (from) query.set("from", from)
        if (to) query.set("to", to)
        const value = await readJson(id ? `${base}/${encodeURIComponent(id)}` : `${base}?${query}`, controller.signal, tenant)
        if (value.tenantId !== tenant) throw new Error(companyChanged)
        const notes = id ? [parseOutgoingXmlNote(value.data)] : Array.isArray(value.data) ? value.data.map(parseOutgoingXmlNote) : null
        if (!notes || id && String(notes[0].id) !== id || !id && (typeof value.canImport !== "boolean" || !Number.isSafeInteger(value.total) || Number(value.total) < notes.length || notes.length > 25)) throw new Error("Resposta fiscal inválida")
        await activeCompany(controller.signal, tenant)
        if (!controller.signal.aborted) setLoaded({ tenantId: tenant, notes, canImport: value.canImport === true, total: id ? 1 : Number(value.total) })
      } catch (reason) { if (!controller.signal.aborted) setError(message(reason)) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); operation.current?.abort(); operation.current = null }
  }, [id, reload, q, from, to, offset, sortQuery])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      if (document.visibilityState !== "visible" || operation.current || !loaded?.tenantId) return
      void activeCompany(controller.signal, loaded.tenantId).catch(() => {
        if (!controller.signal.aborted) { setLoaded(null); setFile(null); setImported(null); setNotice(""); setError(companyChanged); setInputKey(key => key + 1) }
      })
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => { controller.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
  }, [loaded?.tenantId])

  async function importXml() {
    if (!loaded?.canImport || !file || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy("import"); setError(""); setNotice(""); setImported(null)
    let submitted = false
    try {
      if (!file.size || file.size > 900 * 1024) throw new Error("Selecione um XML de até 900 KiB")
      const xml = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())
      if (new TextEncoder().encode(xml).byteLength > 900 * 1024) throw new Error("XML excede 900 KiB")
      const doc = new DOMParser().parseFromString(xml, "application/xml")
      const ns = "http://www.portalfiscal.inf.br/nfe"
      const fields = (tag: string) => doc.getElementsByTagNameNS(ns, tag)
      if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "nfeProc" || doc.documentElement.namespaceURI !== ns
        || fields("mod").length !== 1 || fields("mod")[0].textContent !== "55" || fields("tpNF").length !== 1 || fields("tpNF")[0].textContent !== "1") throw new Error("Envie o XML nfeProc completo de uma NF-e modelo 55 de saída")
      const info = fields("infNFe")
      if (info.length !== 1 || !/^NFe\d{44}$/.test(info[0].getAttribute("Id") || "")) throw new Error("Identificador da NF-e inválido")
      const expectedKey = info[0].getAttribute("Id")!.slice(3)
      const hash = await documentHash(new TextEncoder().encode(xml).buffer)
      await activeCompany(controller.signal, loaded.tenantId)
      submitted = true
      const response = await erpFetch(`${base}/import`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": loaded.tenantId }, body: JSON.stringify({ xml }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]),
      })
      if (!response.ok) {
        if (response.status < 500) submitted = false
        const problem = await response.json().catch(() => null)
        throw new Error(problem?.title || "Não foi possível importar o XML")
      }
      if (![200, 201].includes(response.status) || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Resposta de importação inválida")
      const note = parseOutgoingXmlNote(await response.json())
      if (note.xmlSha256 !== hash || note.accessKey !== expectedKey) throw new Error("A resposta não corresponde ao XML enviado")
      await activeCompany(controller.signal, loaded.tenantId)
      controller.signal.throwIfAborted()
      submitted = false
      setImported(note); setFile(null); setInputKey(key => key + 1)
      setNotice(response.status === 200 ? "Este XML já estava importado. O documento foi preservado." : "XML importado e armazenado com sucesso.")
      setReload(value => value + 1)
    } catch (reason) {
      if (!controller.signal.aborted) { if (message(reason).includes("empresa")) { setLoaded(null); setImported(null); setNotice("") }; setError(submitted ? `Importação não confirmada. Confira a lista antes de reenviar o mesmo arquivo; a repetição é idempotente. ${message(reason)}` : message(reason)) }
    } finally { if (operation.current === controller) operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  async function download(format: "xml" | "danfe") {
    const note = loaded?.notes[0]
    if (!loaded || !note || operation.current) return
    const controller = new AbortController(); operation.current = controller; setBusy(format); setError("")
    try {
      const document = await fetchOutgoingXmlDocument(note, loaded.tenantId, format, controller.signal)
      saveDocument(document.bytes, document.mime, document.filename)
    } catch (reason) { if (!controller.signal.aborted) setError(message(reason)) }
    finally { if (operation.current === controller) operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  const note = id ? loaded?.notes[0] : null
  // A read navigation must not abort a pending XML import operation.
  const sortXml = (field: string) => { if (!busy) table.toggle(field) }
  return <main className="mx-auto max-w-7xl space-y-5 px-4 pb-24 pt-6 lg:px-6">
    <Link className="text-sm text-primary underline" href={id ? "/fiscal/notas-saida/importar" : "/fiscal/notas-saida"}>{id ? "Voltar aos XMLs importados" : "Voltar às notas de saída"}</Link>
    <EntityListPage title={note ? `NF-e ${note.number} · Série ${note.series}` : id ? "XML de saída importado" : "Importar XML de saída"}>
      <div className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">Armazene XMLs completos de NF-e modelo 55 com protocolo de autorização. A importação valida o XML e sua assinatura, sem emitir outra nota ou movimentar estoque e financeiro.</p>
      <p className="text-sm text-muted-foreground">A autorização declarada pertence ao XML. Cancelamentos posteriores e a situação atual dependem de consulta à SEFAZ.</p>
      {loading && <p role="status">Carregando documentos da empresa…</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}{imported && <> <Link className="text-primary underline" href={`/fiscal/notas-saida/importadas/${imported.id}`}>Consultar documento importado</Link></>}</p>}
      {!id && loaded?.canImport && <form className="grid gap-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void importXml() }}>
        <label className="grid gap-2 text-sm">XML da NF-e de saída<Input key={inputKey} type="file" accept=".xml,application/xml,text/xml" disabled={!!busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(""); setNotice(""); setImported(null) }} /></label>
        <p className="text-xs text-muted-foreground">Arquivo nfeProc 4.00 em UTF-8, até 900 KiB. O emitente deve ser a empresa ativa.</p>
        <Button type="submit" disabled={!file || !!busy || loading}>{busy === "import" ? "Validando e importando XML…" : "Importar XML"}</Button>
      </form>}
      {!id && loaded && !loaded.canImport && <p className="text-sm">Você pode consultar os XMLs; solicite permissão fiscal para importar.</p>}
      <Button variant="outline" disabled={loading || !!busy} onClick={() => setReload(value => value + 1)}>Atualizar lista</Button>
      </div>
    </EntityListPage>
    {!id && <section className="form-section space-y-4" aria-label="XMLs de saída importados">
      <h2 className="text-lg font-semibold">XMLs importados</h2>
      <SearchToolbar key={`${q}:${from}:${to}`} pending={loading || !!busy} canClear={!!(q || from || to)} onClear={() => updateFilters({ q: "", from: "", to: "", offset: 0 })} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = { q: String(data.get("q") || "").trim(), from: String(data.get("from") || ""), to: String(data.get("to") || ""), offset: 0 }; if (next.from && next.to && next.from > next.to) { setError("A data inicial deve ser anterior ou igual à final."); return }; updateFilters(next) }}>
        <FilterField label="Buscar XML"><Input name="q" maxLength={200} defaultValue={q} placeholder="Destinatário, CPF/CNPJ, número ou chave" /></FilterField>
        <FilterField label="De"><Input name="from" type="date" defaultValue={from} /></FilterField>
        <FilterField label="Até"><Input name="to" type="date" defaultValue={to} /></FilterField>
      </SearchToolbar>
      {loaded && <p role="status" className="text-sm">{loaded.total} XML(s) importado(s)</p>}
      {loaded && <ResponsiveTable label="Lista de XMLs importados"><DataTable className="w-full min-w-[740px] text-sm"><caption className="sr-only">XMLs de saída da empresa ativa</caption><thead><tr>{[["number", "Nota / série"], ["recipientName", "Destinatário"], ["issuedAt", "Emissão"], ["totalCents", "Total"], ["environment", "Ambiente"]].map(([field, label]) => <SortableTableHeader key={field} className={cell} field={field} sort={table.sort} onSort={sortXml}>{label}</SortableTableHeader>)}</tr></thead><tbody>{loaded.notes.map(row => <tr key={row.id} className="border-t"><td className={cell}><Link className="text-primary underline" href={`/fiscal/notas-saida/importadas/${row.id}`}>NF-e {row.number} / {row.series}</Link><p className="mt-1 text-xs text-muted-foreground">XML importado</p></td><td className={cell}>{row.recipientName}<p className="mt-1 text-xs text-muted-foreground">{row.recipientDocument || "Destinatário no exterior"}</p></td><td className={cell}>{date(row.issuedAt)}</td><CurrencyCell className={cell}>{money.format(row.totalCents / 100)}</CurrencyCell><td className={cell}><StatusBadge tone={row.environment === 2 ? "warning" : "info"}>{row.environment === 2 ? "Homologação · sem valor fiscal" : "Produção declarada no XML"}</StatusBadge></td></tr>)}{!loaded.notes.length && <tr><td colSpan={5}><EmptyState filtered={!!(q || from || to)} description="Nenhum XML encontrado para esta empresa e estes filtros." /></td></tr>}</tbody></DataTable></ResponsiveTable>}
      {loaded && <Pagination offset={offset} pageSize={25} total={loaded.total} loading={!!busy || loading} onOffsetChange={offset => updateFilters({ offset })} />}
    </section>}
    {note && <section className="form-section space-y-4" aria-label="Documento importado">
      <dl className="grid gap-4 text-sm sm:grid-cols-2">{[["Emitente", `${note.issuerName} · ${note.issuerDocument}`], ["Destinatário", `${note.recipientName}${note.recipientDocument ? ` · ${note.recipientDocument}` : ""}`], ["Emissão", date(note.issuedAt)], ["Valor total", `${money.format(note.totalCents / 100)} · ${note.itemCount} item(ns)`], ["Ambiente", note.environment === 2 ? "Homologação · sem valor fiscal" : "Produção declarada no XML"], ["Importado em", date(note.createdAt)]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}<div className="sm:col-span-2"><dt className="text-muted-foreground">Chave de acesso</dt><dd className="break-all">{note.accessKey}</dd></div></dl>
      <div className="flex flex-wrap gap-3"><Button disabled={!!busy} onClick={() => void download("xml")}>{busy === "xml" ? "Conferindo XML…" : "Baixar XML"}</Button><Button variant="outline" disabled={!!busy} onClick={() => void download("danfe")}>{busy === "danfe" ? "Validando e gerando DANFE…" : "Baixar DANFE"}</Button></div>
      <details className="text-xs text-muted-foreground"><summary>Integridade do XML</summary><p className="mt-2 break-all">SHA-256: {note.xmlSha256}</p></details>
    </section>}
  </main>
}
