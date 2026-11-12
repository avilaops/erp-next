"use client"

import { useEffect, useRef, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DraftInput } from "./nfe-draft-model"
import { lookupMunicipalityCode, validMunicipalityCode } from "@/lib/municipality-code"
import type { PartyAddress } from "@/features/parties/party-complements"
import type { PartyFiscal } from "@/features/parties/party-cnpj"

export function NfeRecipientPicker({ tenant, onApply }: { tenant: string; onApply: (recipient: DraftInput["recipient"], fiscal: PartyFiscal | null) => void }) {
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
      const party: Schema<"Party"> & { fiscal?: PartyFiscal | null } = value.data
      if (party.id !== id || !party.isCustomer || party.status !== "active") throw new Error("Cliente indisponível. Atualize a busca.")
      const addresses: PartyAddress[] = party.addresses || []
      const address = addresses.find(item => item.primary) || (addresses.length === 1 ? addresses[0] : undefined)
      if (controller.signal.aborted) return
      onApply({ taxId: party.taxId, legalName: party.legalName, state: address?.state || "", municipalityCode: validMunicipalityCode(address?.municipalityCode, address?.state || "") ? address!.municipalityCode! : "", postalCode: address?.postalCode.replace(/\D/g, "") || "", street: address?.street || "", number: address?.number || "", district: address?.district || "", complement: address?.complement || null, phone: party.phone?.replace(/\D/g, "") || null, email: party.email || null, cityName: address?.city || null }, party.fiscal || null)
      setRows([]); setMessage("Cadastro copiado. Confira endereço, IBGE e classificação ICMS na etapa Tributação.")
    } catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Consulta indisponível") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="space-y-3 rounded-lg border bg-muted/20 p-3"><div className="flex flex-wrap items-end gap-2"><label className="grid min-w-0 flex-1 gap-2 text-sm">Buscar cliente cadastrado<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome ou CPF/CNPJ" /></label><Button type="button" variant="outline" disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? "Consultando…" : "Buscar cliente"}</Button></div>{rows.length > 0 && <ul className="space-y-2">{rows.map(row => <li key={row.id}><Button className="h-auto max-w-full whitespace-normal text-left" type="button" variant="outline" disabled={busy} onClick={() => void choose(row.id)}>Usar {row.legalName} · {row.taxId}</Button></li>)}</ul>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}</div>
}

export function NfeMunicipalityLookup({ tenant, recipient, onResolveMunicipality }: { tenant: string; recipient: DraftInput["recipient"]; onResolveMunicipality: (expected: DraftInput["recipient"], code: string) => void }) {
  const [municipalityMessage, setMunicipalityMessage] = useState("")
  const resolve = useRef(onResolveMunicipality)
  useEffect(() => { resolve.current = onResolveMunicipality })
  useEffect(() => {
    const controller = new AbortController()
    const expected = { ...recipient }
    const timer = setTimeout(() => {
      setMunicipalityMessage("")
      if (!resolve.current || expected.municipalityCode.trim() || !/^\d{8}$/.test(expected.postalCode.replace(/\D/g, "")) || !expected.cityName?.trim() || expected.state.length !== 2 || expected.state === "EX") return
      setMunicipalityMessage("Conferindo o código IBGE pelo CEP…")
      void lookupMunicipalityCode(expected, tenant, controller.signal, erpFetch).then(code => {
        if (controller.signal.aborted) return
        if (code) resolve.current?.(expected, code)
        setMunicipalityMessage(code ? "Código IBGE conferido pelo CEP. Revise antes de salvar." : "Não foi possível confirmar o código IBGE para este endereço. Confira e preencha manualmente.")
      }).catch(() => { if (!controller.signal.aborted) setMunicipalityMessage("Consulta de CEP indisponível. Informe o código IBGE manualmente.") })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [tenant, recipient])
  return municipalityMessage ? <p role="status" className="text-xs text-muted-foreground">{municipalityMessage}</p> : null
}
