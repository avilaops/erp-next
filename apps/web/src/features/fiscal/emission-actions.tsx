"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"
import { useCommand, useResource } from "@/hooks/use-operation"
import { blockerLabels } from "./nfe-draft-model"

type Emission = { tenantId: string; id: string; revision: number; status: string; environment?: "homologation" | "production"; model?: 55 | 65; number: number; series: number; accessKey?: string; protocol?: string; result: { code?: string; reason?: string; blockers?: string[] } }
type FiscalEvent = { id: string; kind: string; sequence: number; revision: number; status: string; request: { text?: string }; result: { reason?: string; protocol?: string } }
type FiscalEvents = { tenantId: string; data: FiscalEvent[] }
type Danfe = { url: string; filename: string; xmlHash: string; pdfHash: string }
const labels: Record<string, string> = { preparing: "Preparação pendente", prepared: "XML preparado", unknown: "Resultado fiscal incerto", rejected: "Rejeitada", cancelled: "Cancelada na SEFAZ" }

async function sha256(bytes: BufferSource) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export function EmissionActions({ id, tenantId, draftRevision, environment, model = 55, canIssue, canTransmit, canCancel, canCorrect, dirty, onLocked, onDocument }: { id: string; tenantId: string; draftRevision: number; environment: "homologation" | "production"; model?: 55 | 65; canIssue: boolean; canTransmit: boolean; canCancel: boolean; canCorrect: boolean; dirty: boolean; onLocked: (locked: boolean) => void; onDocument?: (document: { number: number; series: number } | null) => void }) {
  const resource = useResource<Emission>(`/api/erp/fiscal/nfe/${id}/emission`)
  const events = useResource<FiscalEvents>(`/api/erp/fiscal/nfe/${id}/events`)
  const command = useCommand()
  const [pendingAction, setPendingAction] = useState("issue")
  const [event, setEvent] = useState("correction")
  const [text, setText] = useState("")
  const [notice, setNotice] = useState("")
  const [danfe, setDanfe] = useState<Danfe | null>(null)
  const [danfeBusy, setDanfeBusy] = useState(false)
  const document = resource.value
  const documentModel = document?.model || model
  const documentLabel = documentModel === 65 ? "NFC-e" : "NF-e"
  const cancellationLabel = documentModel === 65 ? "Cancelamento da NFC-e" : "Cancelamento da NF-e"
  const environmentLabel = (document?.environment || environment) === "production" ? "produção" : "homologação"
  const selectedEvent = event === "cancel" && canCancel ? "cancel" : canCorrect ? "correction" : "cancel"
  const allowed = (action: string) => action === "cancel" ? canCancel : action === "correction" ? canCorrect : action === "issue" ? canIssue && canTransmit : action === "consult" && canIssue
  useEffect(() => { onDocument?.(document ? { number: document.number, series: document.series } : null) }, [document, onDocument])
  useEffect(() => { onLocked(Boolean(document?.accessKey || command.busy || command.uncertain)) }, [document?.accessKey, command.busy, command.uncertain, onLocked])
  useEffect(() => () => { if (danfe) URL.revokeObjectURL(danfe.url) }, [danfe])
  const revision = document ? resource.etag : `"${draftRevision}"`
  const mismatched = Boolean(document && (document.tenantId !== tenantId || document.environment && document.environment !== environment))
  async function act(action: string) {
    if (command.busy || mismatched || dirty || !allowed(action)) return
    if (!command.uncertain && !window.confirm(action === "issue" ? `Emitir esta ${documentLabel} em ${environmentLabel}, gerando XML e transmitindo à SEFAZ?` : action === "consult" ? `Consultar e reconciliar este documento em ${environmentLabel} na SEFAZ?` : `Transmitir este evento fiscal em ${environmentLabel} com o texto informado?`)) return
    setPendingAction(action); setNotice("")
    const result = await command.send<Emission>(`/api/erp/fiscal/nfe/${id}/${action}`, tenantId, ["cancel", "correction"].includes(action) ? { text } : {}, revision)
    if (result) { setNotice("Resultado registrado. Confira a situação fiscal atualizada abaixo."); resource.reload(); events.reload() }
  }
  async function download() {
    try {
      const response = await erpFetch(`/api/erp/fiscal/nfe/${id}/xml`, { headers: { "X-Tenant-Id": tenantId } })
      if (!response.ok) { const error = await response.json(); throw new Error(error.title || "XML indisponível") }
      const url = URL.createObjectURL(await response.blob()), link = window.document.createElement("a")
      link.href = url; link.download = `${documentModel === 65 ? "NFCE" : "NFE"}-${document?.accessKey || id}.xml`; link.click(); URL.revokeObjectURL(url)
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao baixar XML") }
  }
  async function generateDanfe() {
    if (danfeBusy || !document?.accessKey) return
    setDanfeBusy(true); setDanfe(null); setNotice("")
    try {
      const xmlResponse = await erpFetch(`/api/erp/fiscal/nfe/${id}/xml`, { headers: { "X-Tenant-Id": tenantId } })
      if (!xmlResponse.ok) { const error = await xmlResponse.json(); throw new Error(error.title || "XML autorizado indisponível") }
      const xml = await xmlResponse.text()
      const response = await erpFetch("/api/erp/fiscal/danfe", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify({ xml }) })
      if (!response.ok) { const error = await response.json(); throw new Error(error.title || "Geração do DANFE recusada") }
      if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("Resposta sem documento PDF")
      const pdf = await response.arrayBuffer()
      const xmlHash = await sha256(new TextEncoder().encode(xml))
      const pdfHash = await sha256(pdf)
      if (xmlHash !== response.headers.get("x-xml-sha256") || pdfHash !== response.headers.get("x-pdf-sha256")) throw new Error("O DANFE recebido não corresponde aos hashes da geração")
      const filename = response.headers.get("content-disposition")?.match(/filename="(DANFE-[0-9]{44}\.pdf)"/)?.[1]
      if (!filename) throw new Error("Nome do DANFE inválido")
      setDanfe({ url: URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })), filename, xmlHash, pdfHash })
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao gerar o DANFE") }
    finally { setDanfeBusy(false) }
  }
  return <section id="fiscal-emission" className="form-section min-w-0 space-y-4" aria-label={`Emissão e eventos da ${documentLabel}`}>
    <h2 className="text-lg font-semibold">Emissão e eventos da {documentLabel}</h2>
    <p className="text-sm text-muted-foreground">{environmentLabel === "homologação" ? "Homologação, sem valor fiscal." : "Produção: confira os dados antes da transmissão."} Salve e confira o rascunho antes de transmitir. Cancelar a nota não desfaz automaticamente a venda ou transfere dinheiro.</p>
    {resource.loading ? <p role="status">Consultando emissão…</p> : mismatched ? <p role="alert">A empresa da sessão mudou. Reabra a nota.</p> : document ? <>
      <p>Situação fiscal: {document.status === "authorized" ? `Autorizada em ${environmentLabel}` : labels[document.status] || document.status}</p>
      <p>{documentLabel} {document.number} · Série {document.series}</p>
      {document.accessKey && <p className="break-all text-sm">Chave: {document.accessKey}</p>}
      {document.protocol && <p className="break-all text-sm">Protocolo: {document.protocol}</p>}
      {document.result?.reason && <p className="text-sm">{document.result.reason}</p>}
      {document.result?.blockers?.map(blocker => <p role="alert" key={blocker}>{blockerLabels[blocker] || "Revise a preparação fiscal"}</p>)}
    </> : resource.status === 404 ? <p>Nenhuma emissão iniciada para este rascunho.</p> : <p role="alert">{resource.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {command.error && <p role="alert">{command.error}</p>}
    {dirty && <p>Salve as alterações do rascunho para habilitar os comandos fiscais.</p>}
    {command.uncertain ? <Button className="min-h-11" disabled={command.busy || !allowed(pendingAction)} onClick={() => void act(pendingAction)}>Conferir mesma operação fiscal</Button> : <div className="flex flex-wrap gap-3">
      {(!document || ["preparing", "prepared", "unknown"].includes(document.status)) && <Button className="h-auto min-h-11 max-w-full whitespace-normal text-center" disabled={!canIssue || !canTransmit || dirty || command.busy || resource.loading || mismatched || command.stale || !document && resource.status !== 404} onClick={() => void act("issue")}>Transmitir {documentLabel} à SEFAZ em {environmentLabel}</Button>}
      {canIssue && document?.accessKey && <Button variant="outline" disabled={dirty || command.busy || command.stale || mismatched} onClick={() => void act("consult")}>Consultar situação na SEFAZ</Button>}
      {document?.accessKey && <Button variant="outline" onClick={() => void download()}>Baixar XML da emissão</Button>}
      {document?.status === "authorized" && document.accessKey && <Button variant="outline" disabled={danfeBusy} onClick={() => void generateDanfe()}>{danfeBusy ? "Gerando DANFE…" : `Gerar DANFE ${documentLabel}`}</Button>}
      <Button variant="outline" disabled={command.busy} onClick={() => { command.reset(); resource.reload() }}>Atualizar situação fiscal</Button>
    </div>}
    {danfe && <div className="space-y-3 rounded-xl border p-4" role="status"><p>{danfe.filename} gerado a partir do XML autorizado.</p><a className="text-primary underline" href={danfe.url} download={danfe.filename}>Baixar DANFE em PDF</a><iframe title={`Visualização do ${documentLabel}`} src={danfe.url} className="h-[75vh] min-h-96 w-full rounded-xl border" /><dl className="break-all text-xs text-muted-foreground"><dt>SHA-256 do XML</dt><dd>{danfe.xmlHash}</dd><dt>SHA-256 do PDF</dt><dd>{danfe.pdfHash}</dd></dl></div>}
    {(canCancel || canCorrect) && document?.status === "authorized" && <form className="space-y-3 rounded-xl border p-4" onSubmit={e => { e.preventDefault(); void act(selectedEvent) }}>
      <fieldset className="space-y-3" disabled={command.busy || command.uncertain || dirty || mismatched}>
        <label className="grid gap-2 text-sm">Evento fiscal<select className="min-h-11 min-w-0 rounded-lg border bg-background px-3" value={selectedEvent} onChange={e => setEvent(e.target.value)}>{canCorrect && <option value="correction">Carta de correção</option>}{canCancel && <option value="cancel">{cancellationLabel}</option>}</select></label>
        <label className="grid gap-2 text-sm">Texto do evento<Input className="min-h-11" value={text} minLength={15} maxLength={selectedEvent === "cancel" ? 255 : 1000} required onChange={e => setText(e.target.value)} /></label>
        <Button className="min-h-11" type="submit" disabled={command.stale}>Transmitir evento fiscal</Button>
      </fieldset>
    </form>}
    {document && events.value?.data.length ? <section className="space-y-3 rounded-xl border p-4" aria-labelledby="fiscal-events-title">
      <h3 id="fiscal-events-title" className="font-semibold">Histórico de eventos fiscais</h3>
      <div className="divide-y divide-border">
        {events.value.data.map(item => <article className="space-y-1 py-3 first:pt-0 last:pb-0" key={item.id}>
          <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{item.kind === "cancelamento" ? "Cancelamento" : item.kind === "correcao" ? "Carta de correção" : item.kind}</strong><span>{item.status}</span></div>
          {item.request.text && <p className="text-sm text-muted-foreground">{item.request.text}</p>}
          {(item.result.protocol || item.result.reason) && <p className="text-xs text-muted-foreground">{item.result.protocol ? `Protocolo: ${item.result.protocol}` : item.result.reason}</p>}
        </article>)}
      </div>
    </section> : null}
  </section>
}
