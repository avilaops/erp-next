"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/hooks/use-operation"

type AssignmentResponse = {
  tenantId: string
  data: {
    id: string
    queue: string
    assignedTo: string | null
    slaDueAt: string | null
    revision: number
  }
}

export function WarrantyAssignment({ id }: { id: string }) {
  const resource = useResource<AssignmentResponse>(`/api/erp/warranty-cases/${id}`)
  if (resource.loading) return <section className="rounded-2xl border p-5"><p role="status">Carregando triagem…</p></section>
  if (resource.error || !resource.value) return <section className="rounded-2xl border p-5"><p role="alert">{resource.error || "Triagem indisponível"}</p></section>

  return <WarrantyAssignmentForm key={`${resource.value.data.id}:${resource.value.data.revision}`} item={resource.value.data} tenantId={resource.value.tenantId} etag={resource.etag} onSaved={resource.reload} />
}

function WarrantyAssignmentForm({ item, tenantId, etag, onSaved }: { item: AssignmentResponse["data"]; tenantId: string; etag: string; onSaved: () => void }) {
  const command = useCommand()
  const [queue, setQueue] = useState(item.queue)
  const [assignedTo, setAssignedTo] = useState(item.assignedTo || "")
  const [slaDueAt, setSlaDueAt] = useState(item.slaDueAt ? item.slaDueAt.slice(0, 16) : "")

  async function save() {
    const result = await command.send(`/api/erp/warranty-cases/${item.id}/assignment`, tenantId, {
      queue: queue.trim(),
      assignedTo: assignedTo.trim() || null,
      slaDueAt: slaDueAt ? new Date(slaDueAt).toISOString() : null,
    }, etag)
    if (result) onSaved()
  }

  return <section className="space-y-4 rounded-2xl border p-5"><div><h2 className="font-semibold">Triagem operacional</h2><p className="mt-1 text-sm text-muted-foreground">Defina a fila, o responsável e o prazo sem alterar o histórico do atendimento.</p></div><label className="grid gap-2 text-sm">Fila<Input value={queue} onChange={event => setQueue(event.target.value)} maxLength={80} /></label><label className="grid gap-2 text-sm">Responsável (ID do funcionário)<Input value={assignedTo} onChange={event => setAssignedTo(event.target.value)} placeholder="UUID opcional" /></label><label className="grid gap-2 text-sm">Prazo do SLA<Input type="datetime-local" value={slaDueAt} onChange={event => setSlaDueAt(event.target.value)} /></label><Button disabled={command.busy || !queue.trim()} onClick={() => void save()}>{command.busy ? "Salvando…" : "Salvar triagem"}</Button>{command.error && <p role="alert">{command.error}</p>}</section>
}
