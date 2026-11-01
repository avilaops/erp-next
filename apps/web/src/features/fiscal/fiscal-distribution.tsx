"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { documentHash, saveDocument } from "./received-documents"

type Manifestation = Schema<"MonitorManifestation">
type Document = Schema<"MonitorDocument">
type Snapshot = Schema<"MonitorSnapshot">
const events: Record<string, string> = { "210210": "Ciência da operação", "210200": "Confirmação da operação", "210220": "Desconhecimento da operação", "210240": "Operação não realizada" }
const outcomes = { unknown: "Resultado não confirmado — conferir antes de qualquer nova ação", accepted: "Registrada e vinculada à NF-e", rejected: "Recusada pela SEFAZ" }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export function FiscalDistribution() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(0)
  const operation = useRef(false)
  const command = useRef<{ tenant: string; key: string } | null>(null)
  const tenant = useRef("")

  useEffect(() => {
    const controller = new AbortController()
    erpFetch(`/api/erp/fiscal/monitor${offset ? `?offset=${offset}` : ""}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível carregar a distribuição fiscal")
      if (controller.signal.aborted) return
      if (tenant.current && tenant.current !== value.tenantId) { command.current = null; setNotice("") }
      tenant.current = value.tenantId
      setSnapshot(value); setNow(Date.now())
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, refresh])

  useEffect(() => {
    if (!snapshot?.nextQueryAt) return
    const delay = Math.max(100, new Date(snapshot.nextQueryAt).getTime() - Date.now() + 100)
    const timer = setTimeout(() => setNow(Date.now()), Math.min(delay, 3600_000))
    return () => clearTimeout(timer)
  }, [snapshot])

  function reload() { setLoading(true); setError(""); setRefresh(value => value + 1) }
  async function collect() {
    if (!snapshot || operation.current || loading) return
    operation.current = true; setBusy(true); setError(""); setNotice("")
    if (!command.current || command.current.tenant !== snapshot.tenantId) command.current = { tenant: snapshot.tenantId, key: crypto.randomUUID() }
    try {
      const response = await erpFetch("/api/erp/fiscal/monitor/sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "Idempotency-Key": command.current.key }, body: "{}" })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível confirmar a consulta. Atualize o monitor")
      if (value.outcome === "applied") setNotice(`Lote consultado: ${value.documentCount} documento(s). Nenhum lançamento de estoque ou financeiro foi criado.`)
      else setNotice(value.outcome === "pending" ? "A consulta está em andamento ou foi interrompida. Confira o monitor; a mesma solicitação não será reenviada." : "A consulta não foi aplicada. O cursor foi preservado; aguarde a próxima consulta liberada.")
      command.current = null
      reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Consulta não confirmada. Atualize o monitor antes de repetir") }
    finally { operation.current = false; setBusy(false) }
  }

  const wait = !!snapshot?.nextQueryAt && new Date(snapshot.nextQueryAt).getTime() > now
  return <section className="form-section min-w-0 space-y-4" aria-labelledby="distribution-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="distribution-title" className="text-lg font-semibold">Distribuição da SEFAZ</h2><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || busy} onClick={reload}>Atualizar distribuição</Button><Button disabled={loading || busy || !snapshot?.canSync || !snapshot.collectionEnabled || !snapshot.certificateReady || wait} onClick={() => void collect()}>{busy ? "Consultando SEFAZ…" : "Consultar SEFAZ"}</Button></div></div>
    <p className="text-sm text-muted-foreground">Consulte um lote de documentos destinados ao CNPJ. O ERP conserva o cursor único e os arquivos originais. A manifestação depende de uma ação explícita em cada nota.</p>
    {loading && <p role="status" className="text-sm">Carregando distribuição…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {snapshot && <>
      <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Último NSU</dt><dd>{snapshot.lastNsu}</dd></div><div><dt className="text-muted-foreground">Maior NSU informado</dt><dd>{snapshot.maxNsu}</dd></div><div><dt className="text-muted-foreground">Último retorno</dt><dd>{snapshot.lastStatus || "Nenhuma consulta concluída"}</dd></div></dl>
      {!snapshot.collectionEnabled && <p className="text-sm">A coleta na SEFAZ está desativada neste ambiente.</p>}
      {!snapshot.certificateReady && <p className="text-sm">Cadastre um certificado A1 vigente nas configurações fiscais para consultar.</p>}
      {wait && <p className="text-sm">Próxima consulta a partir de {new Date(snapshot.nextQueryAt!).toLocaleString("pt-BR")}.</p>}
      {snapshot.lastRun?.outcome === "failed" && <p className="text-sm">A última consulta falhou. O lote não foi aplicado e o cursor foi preservado.</p>}
      {snapshot.lastRun?.outcome === "pending" && <p className="text-sm">A última consulta ainda não teve resultado confirmado. A pausa de proteção permanece ativa.</p>}
      <div className="space-y-3">{snapshot.documents.map(document => <DistributionDocument key={`${snapshot.tenantId}-${document.id}`} document={document} snapshot={snapshot} reload={reload} />)}</div>
      {!snapshot.documents.length && <p className="text-sm text-muted-foreground">Nenhum documento coletado na SEFAZ.</p>}
      {snapshot.total > 25 && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!offset || loading || busy} onClick={() => { setLoading(true); setOffset(value => Math.max(0, value - 25)) }}>Anteriores</Button><span className="text-sm">{offset + 1}–{Math.min(offset + 25, snapshot.total)} de {snapshot.total}</span><Button variant="outline" disabled={offset + 25 >= snapshot.total || loading || busy} onClick={() => { setLoading(true); setOffset(value => value + 25) }}>Próximos</Button></div>}
    </>}
  </section>
}

function DistributionDocument({ document, snapshot, reload }: { document: Document; snapshot: Snapshot; reload: () => void }) {
  const [eventType, setEventType] = useState("")
  const [justification, setJustification] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const operation = useRef(false)
  const command = useRef<{ payload: string; key: string } | null>(null)
  const existing = document.manifestations.some(value => value.eventType === eventType)

  async function manifest(event: React.FormEvent) {
    event.preventDefault()
    if (operation.current || !eventType || !confirmed || existing) return
    operation.current = true; setBusy(true); setError("")
    const payload = JSON.stringify({ eventType, justification: eventType === "210240" ? justification : null })
    if (!command.current || command.current.payload !== payload) command.current = { payload, key: crypto.randomUUID() }
    try {
      const response = await erpFetch(`/api/erp/fiscal/monitor/documents/${document.id}/manifest`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "Idempotency-Key": command.current.key }, body: payload })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Manifestação não confirmada. Atualize o monitor")
      setConfirmed(false); reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Manifestação não confirmada") }
    finally { operation.current = false; setBusy(false) }
  }
  async function download() {
    if (operation.current) return
    operation.current = true; setBusy(true); setError("")
    try {
      const response = await erpFetch(`/api/erp/fiscal/monitor/documents/${document.id}/xml`, { cache: "no-store", headers: { "X-Tenant-Id": snapshot.tenantId } })
      if (!response.ok) { const value = await response.json(); throw new Error(value.title || "Documento indisponível") }
      const bytes = await response.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > 900 * 1024 || !response.headers.get("content-type")?.startsWith("application/xml") || await documentHash(bytes) !== document.xmlSha256 || response.headers.get("x-xml-sha256") !== document.xmlSha256) throw new Error("O arquivo não corresponde ao documento coletado")
      saveDocument(new Uint8Array(bytes), "application/xml", `DFE-${document.nsu}.xml`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Documento indisponível") }
    finally { operation.current = false; setBusy(false) }
  }
  return <article className="min-w-0 space-y-3 rounded-xl border p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{document.issuerName || (document.kind === "event" ? "Evento fiscal" : "Documento fiscal")}</p><p className="text-muted-foreground">NSU {document.nsu} · {document.kind === "summary" ? "Resumo da NF-e" : document.kind === "nfe" ? "NF-e completa" : document.schema}</p></div>{document.totalCents != null && <p className="font-medium">{money.format(document.totalCents / 100)}</p>}</div>
    {document.accessKey && <p className="break-all text-xs">Chave: {document.accessKey}</p>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy} onClick={() => void download()}>Baixar XML {document.kind === "summary" ? "do resumo" : "coletado"}</Button>{document.receivedNfeId && <Link className="text-primary underline" href={`/fiscal/monitor/${document.receivedNfeId}`}>Abrir NF-e completa e DANFE</Link>}</div>
    {document.manifestations.map(value => <p key={value.id}>{events[value.eventType]}: {outcomes[value.outcome as keyof typeof outcomes] || value.outcome}{value.status ? ` · SEFAZ ${value.status}` : ""}{value.protocol ? ` · Protocolo ${value.protocol}` : ""}</p>)}
    {snapshot.canManifest && snapshot.collectionEnabled && snapshot.certificateReady && document.kind === "summary" && document.situation === "1" && <details><summary className="cursor-pointer font-medium">Manifestar esta NF-e</summary><form className="mt-3 grid gap-3" onSubmit={manifest}>
      <div className="grid gap-2"><label htmlFor={`manifest-type-${document.id}`}>Evento de manifestação</label><select id={`manifest-type-${document.id}`} className="max-w-full rounded-lg border bg-background p-2" disabled={busy} value={eventType} onChange={event => { setEventType(event.target.value); setConfirmed(false) }}><option value="">Selecione o evento</option>{Object.entries(events).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
      {eventType === "210240" && <label className="grid gap-2">Justificativa (15 a 255 caracteres)<Textarea minLength={15} maxLength={255} required value={justification} onChange={event => setJustification(event.target.value)} disabled={busy} /></label>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy || !eventType || existing} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo o envio deste evento à SEFAZ para esta NF-e.</span></label>
      {existing && <p>Este evento já possui uma solicitação registrada; confira seu resultado acima.</p>}
      <Button type="submit" disabled={busy || !eventType || !confirmed || existing || (eventType === "210240" && justification.trim().length < 15)}>{busy ? "Enviando manifestação…" : "Enviar manifestação à SEFAZ"}</Button>
    </form></details>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </article>
}
