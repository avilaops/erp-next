"use client"

import { useEffect, useRef, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DraftInput } from "./nfe-draft-model"

export function NfeRecipientPicker({ tenant, onApply }: { tenant: string; onApply: (recipient: DraftInput["recipient"]) => void }) {
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<Schema<"Party">[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [tenant])
  async function search() {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setBusy(true); setMessage(""); setRows([])
    try {
      const response = await erpFetch(`/api/erp/parties?role=customer&status=active&limit=20&q=${encodeURIComponent(query)}`, { signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível buscar os clientes")
      if (value.tenantId !== tenant) throw new Error("A empresa da sessão mudou. Reabra a nota.")
      if (!controller.signal.aborted) { setRows(value.data); if (!value.data.length) setMessage("Nenhum cliente encontrado. Você pode preencher manualmente.") }
    } catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Consulta indisponível") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function choose(id: string) {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setBusy(true); setMessage("")
    try {
      const [response, meResponse] = await Promise.all([erpFetch(`/api/erp/parties/${id}`, { signal: controller.signal }), erpFetch("/api/erp/me", { signal: controller.signal })])
      const [value, me] = await Promise.all([response.json(), meResponse.json()])
      if (!response.ok) throw new Error(value.title || "Não foi possível abrir o cliente")
      if (!meResponse.ok || me.tenant?.id !== tenant || value.tenantId !== tenant) throw new Error("A empresa da sessão mudou. Reabra a nota.")
      const party: Schema<"Party"> = value.data
      const addresses = party.addresses || []
      const address = addresses.find(item => item.primary) || (addresses.length === 1 ? addresses[0] : undefined)
      if (controller.signal.aborted) return
      onApply({ taxId: party.taxId, legalName: party.legalName, state: address?.state || "", municipalityCode: "", postalCode: address?.postalCode.replace(/\D/g, "") || "", street: address?.street || "", number: address?.number || "", district: address?.district || "", complement: address?.complement || null, phone: party.phone?.replace(/\D/g, "") || null, email: party.email || null, cityName: address?.city || null })
      setRows([]); setMessage("Cadastro copiado. Confira o endereço e informe o código IBGE do destinatário.")
    } catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Consulta indisponível") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="space-y-3 rounded-lg border bg-muted/20 p-3"><div className="flex flex-wrap items-end gap-2"><label className="grid min-w-0 flex-1 gap-2 text-sm">Buscar cliente cadastrado<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome ou CPF/CNPJ" /></label><Button type="button" variant="outline" disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? "Consultando…" : "Buscar cliente"}</Button></div>{rows.length > 0 && <ul className="space-y-2">{rows.map(row => <li key={row.id}><Button className="h-auto max-w-full whitespace-normal text-left" type="button" variant="outline" disabled={busy} onClick={() => void choose(row.id)}>Usar {row.legalName} · {row.taxId}</Button></li>)}</ul>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}</div>
}
