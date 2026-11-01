"use client"

import { RequestError } from "@/components/feedback/session-recovery"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useResource } from "@/hooks/use-operation"

export type PurchaseChoice = { id: string; legalName?: string; name?: string; sku?: string; unit?: string }

export function PurchaseLookup({ supplier = false, disabled, choose }: { supplier?: boolean; disabled: boolean; choose: (value: PurchaseChoice) => void }) {
  const label = supplier ? "fornecedor" : "produto"
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "10", status: "active", ...(supplier ? { role: "supplier" } : {}) })
  const result = useResource<{ data: PurchaseChoice[]; total: number }>(`/api/erp/${supplier ? "parties" : "products"}?${params}`)
  return <section className="min-w-0 space-y-3 rounded-xl border p-4" aria-label={`Seleção de ${label}`}>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery({ q: String(new FormData(event.currentTarget).get("q") || ""), offset: 0 }) }}>
      <label className="min-w-0 flex-1 space-y-2">Buscar {label}<Input name="q" maxLength={160} disabled={disabled} /></label>
      <Button type="submit" disabled={disabled || result.loading}>Pesquisar {label}</Button>
    </form>
    {result.loading ? <p role="status">Consultando {label}…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : <>
      <ul className="space-y-2">{result.value?.data.map(value => <li key={value.id}><Button className="h-auto max-w-full whitespace-normal break-words text-left" variant="outline" disabled={disabled} onClick={() => choose(value)}>Selecionar {value.legalName || value.name}{value.sku ? ` · ${value.sku}` : ""}</Button></li>)}</ul>
      {!result.value?.data.length && <p>Nenhum {label} encontrado.</p>}
      <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" disabled={disabled || result.loading || !query.offset} onClick={() => setQuery({ ...query, offset: query.offset - 10 })}>Anterior {label}</Button><Button variant="outline" disabled={disabled || result.loading || query.offset + 10 >= (result.value?.total || 0)} onClick={() => setQuery({ ...query, offset: query.offset + 10 })}>Próximo {label}</Button></div>
    </>}
  </section>
}
