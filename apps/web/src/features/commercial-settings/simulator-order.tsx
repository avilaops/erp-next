"use client"
import { catalogPaletteFor } from "@/features/catalog/catalog-color-photo-model"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand } from "@/hooks/use-operation"
import { ColorChoice, Lookup, type Choice } from "@/features/sales/orders"
import type { Equipment, Simulation } from "./simulator-model"

export function SimulationOrder({ value, equipment, line, onLocked }: {
  value: Simulation; equipment: Equipment; line: string; onLocked: (locked: boolean) => void
}) {
  const command = useCommand()
  const router = useRouter()
  const [customer, setCustomer] = useState<Choice | null>(null)
  const [dueDate, setDueDate] = useState("")
  const [structure, setStructure] = useState("")
  const [upholstery, setUpholstery] = useState("")
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain
  useEffect(() => { onLocked(frozen) }, [frozen, onLocked])
  return <section className="form-section min-w-0 space-y-4" aria-label="Criar pedido da simulação">
    <h2 className="font-semibold">Criar pedido</h2><p className="text-sm text-muted-foreground">O rascunho preserva a versão, os preços e as condições desta simulação.</p>
    <Lookup endpoint="parties" label="cliente" disabled={frozen} searchOnly choose={setCustomer} selectedName={customer?.legalName} />
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (!customer || command.busy) return
      setError("")
      const result = await command.send<{ tenantId: string; id: string; status: string }>(`/api/erp/sales-simulator/${line}/orders`, value.tenantId, {
        quote: value.input, digest: value.digest, customerId: customer.id, dueDate,
        structureColor: structure || null, upholsteryColor: upholstery || null,
      })
      if (result?.tenantId === value.tenantId && result.status === "draft" && /^[a-f0-9-]{36}$/.test(result.id)) router.replace(`/vendas/pedidos/${result.id}`)
      else if (result) setError("Confirmação divergente. Consulte os pedidos antes de repetir.")
    }}>
      <fieldset disabled={frozen} className="space-y-4">
        <label className="grid gap-2">Vencimento<Input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><ColorChoice label="Cor da estrutura" options={equipment.structureColors} value={structure} onChange={setStructure} /><ColorChoice palette={catalogPaletteFor(equipment.structureColors)} label={catalogPaletteFor(equipment.structureColors) ? "Cor dos braços" : "Cor do estofado"} options={equipment.upholsteryColors} value={upholstery} onChange={setUpholstery} /></div>
      </fieldset>
      {(error || command.error) && <p role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></p>}
      {command.stale && <p>Refaça a simulação antes de criar outro pedido.</p>}
      {command.uncertain && <p role="status">Resultado pendente. A repetição confere o mesmo comando.</p>}
      <Button type="submit" disabled={!customer || command.busy || command.stale || !!error}>{command.busy ? "Confirmando…" : command.uncertain ? "Conferir criação do pedido" : "Criar rascunho com estas condições"}</Button>
    </form>
  </section>
}
