"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource, useCommand } from "@/hooks/use-operation"
import { RequestError } from "@/components/feedback/session-recovery"
import { NegotiationResult } from "./negotiation-result"
import type { Sale, Director, SimulationInput } from "./negotiation-types"

type Snapshot = { tenantId: string; revision: number; data: { sale: Sale; version: number; input?: Pick<SimulationInput, "destinationState" | "taxpayer"> } | null; director: Director | null; approvalStatus: string; canApprove: boolean; decisions: { decision: string; reason: string; createdAt: string; decidedBy: string }[] }
const statuses: Record<string, string> = { not_required: "Dentro da política", pending: "Aguardando aprovação", approved: "Aprovada", rejected: "Recusada: refaça a negociação" }
export function OrderNegotiation({ id, onDecision, showDirector = false }: { id: string; onDecision: () => void; showDirector?: boolean }) {
  const resource = useResource<Snapshot>(`/api/erp/commercial/orders/${id}`)
  const command = useCommand()
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState<boolean | null>(null)
  async function decide(approved: boolean) {
    if (!resource.value || !resource.etag || !reason.trim()) return
    setPending(approved)
    const result = await command.send(`/api/erp/commercial/orders/${id}/decision`, resource.value.tenantId, { approved, reason }, resource.etag)
    if (result) { setReason(""); setPending(null); resource.reload(); onDecision() }
  }
  if (resource.loading) return <p role="status">Conferindo condições negociadas…</p>
  if (resource.error) return <p role="alert"><RequestError message={resource.error} status={resource.status} /></p>
  const value = resource.value
  if (!value?.data) return null
  return <section className="min-w-0 space-y-4"><h2 className="font-semibold">Negociação · tabela v{value.data.version}</h2><p role="status">{statuses[value.approvalStatus] || value.approvalStatus}</p>
    {value.data.input && <p className="text-sm">Destino: {value.data.input.destinationState} · {value.data.input.taxpayer ? "Contribuinte de ICMS" : "Não contribuinte de ICMS"}</p>}
    <NegotiationResult sale={value.data.sale} director={showDirector ? value.director : null} />
    {value.approvalStatus === "pending" && value.canApprove && <div className="form-section space-y-3"><label className="grid gap-2">Motivo da decisão<Input disabled={command.busy || command.uncertain} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="flex flex-wrap gap-3"><Button disabled={!reason.trim() || command.busy || command.stale || (command.uncertain && pending !== true)} onClick={() => decide(true)}>Aprovar negociação</Button><Button variant="outline" disabled={!reason.trim() || command.busy || command.stale || (command.uncertain && pending !== false)} onClick={() => decide(false)}>Recusar negociação</Button></div></div>}
    {value.decisions.length > 0 && <details><summary>Histórico de decisões</summary><ul className="space-y-3 pt-3">{value.decisions.map((decision, index) => <li key={index} className="rounded-lg border p-3"><p>{decision.decision === "approved" ? "Aprovada" : "Recusada"} · {decision.decidedBy} · {new Date(decision.createdAt).toLocaleString("pt-BR")}</p><p className="whitespace-pre-wrap break-words">{decision.reason}</p></li>)}</ul></details>}
    {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}{command.stale && <Button variant="outline" onClick={() => { command.reset(); resource.reload(); onDecision() }}>Conferir revisão atual</Button>}
  </section>
}
