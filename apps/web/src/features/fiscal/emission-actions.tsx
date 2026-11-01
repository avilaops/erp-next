"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/hooks/use-operation"
import { blockerLabels } from "./nfe-draft-model"

type Emission = { tenantId: string; id: string; revision: number; status: string; number: number; series: number; accessKey?: string; protocol?: string; result: { code?: string; reason?: string; blockers?: string[] } }
const labels: Record<string, string> = { preparing: "Preparação pendente", prepared: "XML preparado", unknown: "Resultado fiscal incerto", authorized: "Autorizada em homologação", rejected: "Rejeitada", cancelled: "Cancelada na SEFAZ" }

export function EmissionActions({ id, tenantId, draftRevision, canIssue, dirty, onLocked }: { id: string; tenantId: string; draftRevision: number; canIssue: boolean; dirty: boolean; onLocked: (locked: boolean) => void }) {
  const resource = useResource<Emission>(`/api/erp/fiscal/nfe/${id}/emission`)
  const command = useCommand()
  const [pendingAction, setPendingAction] = useState("issue")
  const [event, setEvent] = useState("correction")
  const [text, setText] = useState("")
  const [notice, setNotice] = useState("")
  const document = resource.value
  useEffect(() => { onLocked(Boolean(document?.accessKey || command.busy || command.uncertain)) }, [document?.accessKey, command.busy, command.uncertain, onLocked])
  const revision = document ? resource.etag : `"${draftRevision}"`
  const mismatched = Boolean(document && document.tenantId !== tenantId)
  async function act(action: string) {
    if (command.busy || mismatched || dirty) return
    if (!command.uncertain && !window.confirm(action === "issue" ? "Emitir esta NF-e em homologação, gerando XML e transmitindo à SEFAZ?" : action === "consult" ? "Consultar e reconciliar a situação deste documento na SEFAZ?" : "Transmitir este evento fiscal em homologação com o texto informado?")) return
    setPendingAction(action); setNotice("")
    const result = await command.send<Emission>(`/api/erp/fiscal/nfe/${id}/${action}`, tenantId, ["cancel", "correction"].includes(action) ? { text } : {}, revision)
    if (result) { setNotice("Resultado registrado. Confira a situação fiscal atualizada abaixo."); resource.reload() }
  }
  async function download() {
    try {
      const response = await fetch(`/api/erp/fiscal/nfe/${id}/xml`, { headers: { "X-Tenant-Id": tenantId }, cache: "no-store" })
      if (!response.ok) { const error = await response.json(); throw new Error(error.title || "XML indisponível") }
      const url = URL.createObjectURL(await response.blob()), link = window.document.createElement("a")
      link.href = url; link.download = `NFE-${document?.accessKey || id}.xml`; link.click(); URL.revokeObjectURL(url)
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao baixar XML") }
  }
  return <section className="form-section min-w-0 space-y-4" aria-label="Emissão e eventos da NF-e">
    <h2 className="text-lg font-semibold">Emissão e eventos da NF-e</h2>
    <p className="text-sm text-muted-foreground">Homologação, sem valor fiscal. Salve e confira o rascunho antes de transmitir. Cancelar a nota não desfaz automaticamente a venda ou transfere dinheiro.</p>
    {resource.loading ? <p role="status">Consultando emissão…</p> : mismatched ? <p role="alert">A empresa da sessão mudou. Reabra a nota.</p> : document ? <>
      <p>Situação fiscal: {labels[document.status] || document.status}</p>
      <p>NF-e {document.number} · Série {document.series}</p>
      {document.accessKey && <p className="break-all text-sm">Chave: {document.accessKey}</p>}
      {document.protocol && <p className="break-all text-sm">Protocolo: {document.protocol}</p>}
      {document.result?.reason && <p className="text-sm">{document.result.reason}</p>}
      {document.result?.blockers?.map(blocker => <p role="alert" key={blocker}>{blockerLabels[blocker] || "Revise a preparação fiscal"}</p>)}
    </> : resource.status === 404 ? <p>Nenhuma emissão iniciada para este rascunho.</p> : <p role="alert">{resource.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {command.error && <p role="alert">{command.error}</p>}
    {dirty && <p>Salve as alterações do rascunho para habilitar os comandos fiscais.</p>}
    {command.uncertain ? <Button disabled={command.busy} onClick={() => void act(pendingAction)}>Conferir mesma operação fiscal</Button> : <div className="flex flex-wrap gap-3">
      {canIssue && (!document || ["preparing", "prepared", "unknown"].includes(document.status)) && <Button disabled={dirty || command.busy || resource.loading || mismatched || command.stale} onClick={() => void act("issue")}>Emitir NF-e em homologação</Button>}
      {canIssue && document?.accessKey && <Button variant="outline" disabled={dirty || command.busy || command.stale || mismatched} onClick={() => void act("consult")}>Consultar situação na SEFAZ</Button>}
      {document?.accessKey && <Button variant="outline" onClick={() => void download()}>Baixar XML da emissão</Button>}
      <Button variant="outline" disabled={command.busy} onClick={() => { command.reset(); resource.reload() }}>Atualizar situação fiscal</Button>
    </div>}
    {canIssue && document?.status === "authorized" && <form className="space-y-3 rounded-xl border p-4" onSubmit={e => { e.preventDefault(); void act(event) }}>
      <fieldset className="space-y-3" disabled={command.busy || command.uncertain || dirty || mismatched}>
        <label className="grid gap-2 text-sm">Evento fiscal<select className="min-h-10 rounded-lg border bg-background px-3" value={event} onChange={e => setEvent(e.target.value)}><option value="correction">Carta de correção</option><option value="cancel">Cancelamento da NF-e</option></select></label>
        <label className="grid gap-2 text-sm">Texto do evento<Input value={text} minLength={15} maxLength={event === "cancel" ? 255 : 1000} required onChange={e => setText(e.target.value)} /></label>
        <Button type="submit" disabled={command.stale}>Transmitir evento fiscal</Button>
      </fieldset>
    </form>}
  </section>
}
