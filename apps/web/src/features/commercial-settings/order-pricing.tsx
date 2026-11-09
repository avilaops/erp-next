"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { SimulationResult } from "./simulator-result"
import type { Simulation } from "./simulator-model"

type Pricing = { tenantId: string; canApprove: boolean; data: { snapshot: Simulation; needsApproval: boolean; approved: boolean } | null }

export function OrderPricing({ id, onSaved, showDirector = false }: { id: string; onSaved: () => void; showDirector?: boolean }) {
  const resource = useResource<Pricing>(`/api/erp/orders/${id}/pricing`)
  const command = useCommand()
  const [reason, setReason] = useState("")
  const [notice, setNotice] = useState("")
  useNavigationGuard(command.busy || command.uncertain ? "A aprovação ainda não foi confirmada. Sair?" : null)
  const value = resource.value
  if (resource.loading) return <p role="status">Consultando condições da simulação…</p>
  if (resource.error) return <div role="alert"><RequestError message={resource.error} status={resource.status} /><Button onClick={resource.reload}>Tentar novamente</Button></div>
  if (!value?.data) return null
  const data = value.data
  return <section className="space-y-4" aria-label="Condições comerciais preservadas">
    <h2 className="font-semibold">Condições comerciais · tabela v{data.snapshot.version}</h2>
    <p className="text-sm text-muted-foreground">Este pedido preserva a simulação e não permite editar seus itens. Para negociar outras condições, cancele o rascunho e <Link className="text-primary underline" href="/vendas/simulador">refaça a simulação</Link>.</p>
    <SimulationResult value={showDirector ? data.snapshot : { ...data.snapshot, director: undefined }} imported={data.snapshot.line === "imported"} />
    {data.needsApproval && <p role="status" className="font-medium">{data.approved ? "Exceção comercial aprovada pela gestão." : "Aguardando aprovação da gestão antes da confirmação."}</p>}
    {notice && <p role="status">{notice}</p>}
    {value.canApprove && data.needsApproval && !data.approved && <form className="space-y-3" onSubmit={async event => {
      event.preventDefault()
      const result = await command.send<{ tenantId: string; approved: boolean }>(`/api/erp/orders/${id}/pricing/approve`, value.tenantId, { reason }, resource.etag)
      if (result?.tenantId === value.tenantId && result.approved) { setNotice("Aprovação registrada."); setReason(""); resource.reload(); onSaved() }
    }}>
      <label className="grid gap-2">Motivo da aprovação<Input required minLength={3} maxLength={2000} value={reason} disabled={command.busy || command.uncertain || command.stale} onChange={event => setReason(event.target.value)} /></label>
      <Button type="submit" disabled={command.busy || command.stale}>{command.busy ? "Confirmando…" : command.uncertain ? "Conferir aprovação" : "Aprovar exceção comercial"}</Button>
      {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
      {command.stale && <Button type="button" variant="outline" onClick={() => { command.reset(); resource.reload(); onSaved() }}>Recarregar pedido</Button>}
    </form>}
  </section>
}
