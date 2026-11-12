"use client"

import { Pagination } from "@/components/workspace/pagination"
import { erpFetch } from "@/lib/api/client"
import { lookupMunicipalityCode } from "@/lib/municipality-code"

import type { Schema } from "@/lib/api/types"

import { AccessLink } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { DataTable } from "@/components/workspace/data-table"
import { PageHeader } from "@/components/page-header"
import { RecordCompany } from "@/components/record-company"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"

import { PartyComplements } from "./party-complements"
import { RegistryLookup } from "@/features/records/registry-lookup"
import { clearPartyCnpj, emptyCnpjProvenance, fillPartyCnpj, type PartyDraft } from "./party-cnpj"
import "@/features/records/compact-form.css"

type PartyInput = PartyDraft
type Party = Schema<"Party">
type Snapshot = Omit<Schema<"PartySnapshot">, "data"> & { data?: Schema<"Party"> }
type Page = Schema<"PartyList">
const blank: PartyInput = { personType: "juridica", legalName: "", tradeName: null, taxId: "", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [] }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function values(party: Party): PartyInput {
  return { personType: party.personType, legalName: party.legalName, tradeName: party.tradeName, taxId: party.taxId, email: party.email, phone: party.phone, isCustomer: party.isCustomer, isSupplier: party.isSupplier, status: party.status, addresses: party.addresses || [], contacts: party.contacts || [] }
}
function relationship(party: Pick<PartyInput, "isCustomer" | "isSupplier">) { return party.isCustomer && party.isSupplier ? "Cliente e fornecedor" : party.isCustomer ? "Cliente" : "Fornecedor" }

export function PartyList() {
  const [query, setQuery] = useState({ q: "", role: "", status: "", offset: 0 })
  const [result, setResult] = useState<Page | null>(null)
  const [error, setError] = useState("")
  const [responseStatus, setResponseStatus] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let requestStatus = 0
    const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
    if (query.role) params.set("role", query.role)
    if (query.status) params.set("status", query.status)
    erpFetch(`/api/erp/parties?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      requestStatus = response.status
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Cadastros indisponíveis")
      if (!controller.signal.aborted) { setResult(data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message); setResponseStatus(requestStatus) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, retry])

  return <>

    <section className="compact-records form-section min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Pessoas cadastradas</h2>{result?.canEdit && <Link className={linkClass} href="/cadastros/clientes-fornecedores/novo">Nova pessoa</Link>}</div>
      <form className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); setLoading(true)
        setQuery({ q: String(form.get("q") || ""), role: String(form.get("role") || ""), status: String(form.get("status") || ""), offset: 0 })
      }}>
        <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><label className="min-w-0 space-y-1">Buscar nome ou documento<SearchInput onSearch={(q, form) => { const fields = form ? new FormData(form) : null; setLoading(true); setQuery({ q, role: String(fields?.get("role") || ""), status: String(fields?.get("status") || ""), offset: 0 }) }} name="q" maxLength={160} placeholder="Documento sem máscara" /></label><Button className="h-9 px-3" type="submit" disabled={loading}>Buscar</Button></div>
        <label className="min-w-0 space-y-1">Relacionamento<select name="role" className={selectClass}><option value="">Todos</option><option value="customer">Clientes</option><option value="supplier">Fornecedores</option></select></label>
        <label className="min-w-0 space-y-1">Situação<select name="status" className={selectClass}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
      </form>
      {loading ? <p role="status">Carregando pessoas…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p>{responseStatus === 401 && <AccessLink className={linkClass}>Entrar com Avila Ops</AccessLink>}<Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} pessoa(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de clientes e fornecedores" tabIndex={0}><DataTable aria-label="Clientes e fornecedores" className="table-fixed lg:table-auto">
          <thead><tr><th scope="col" className="w-[55%] lg:w-auto">Nome</th><th scope="col" className="hidden lg:table-cell">CPF / CNPJ</th><th scope="col" className="hidden lg:table-cell">Relacionamento</th><th scope="col">Contato</th><th scope="col" className="hidden lg:table-cell">Situação</th></tr></thead>
          <tbody>{result.data.map(party => <tr key={party.id}>
            <th scope="row" className="align-top font-medium"><Link className={`${linkClass} line-clamp-2 [overflow-wrap:anywhere] lg:line-clamp-none`} title={party.legalName} href={`/cadastros/clientes-fornecedores/${party.id}`}>{party.legalName}</Link><div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground lg:hidden"><p className="[overflow-wrap:anywhere]">{party.taxId}</p><p>{relationship(party)}</p><p>{party.status === "active" ? "Ativo" : "Arquivado"}</p></div></th>
            <td className="hidden whitespace-nowrap lg:table-cell">{party.taxId}</td><td className="hidden lg:table-cell">{relationship(party)}</td><td className="align-top [overflow-wrap:anywhere]">{party.email && <p>{party.email}</p>}{party.phone && <p className="mt-1 text-xs text-muted-foreground">{party.phone}</p>}{!party.email && !party.phone && "Não informado"}</td><td className="hidden lg:table-cell">{party.status === "active" ? "Ativo" : "Arquivado"}</td>
          </tr>)}</tbody>
        </DataTable></div> : <p>Nenhuma pessoa encontrada.</p>}
        <Pagination offset={query.offset} pageSize={25} total={result.total} onOffsetChange={offset => { setLoading(true); setQuery(value => ({ ...value, offset })) }} />
      </>}
    </section>
  </>
}

export function PartyEditor({ id, view = false }: { id?: string; view?: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<PartyInput>({ ...blank })
  const [baseline, setBaseline] = useState(JSON.stringify(blank))
  const [etag, setEtag] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const pending = useRef(false)
  const command = useRef<{ key: string; body: string } | null>(null)
  const cnpjProvenance = useRef(emptyCnpjProvenance())
  const dirty = JSON.stringify(draft) !== baseline
  const municipalityTenant = snapshot?.tenantId
  const canResolveMunicipalities = !view && !loading && snapshot?.canEdit && !saving && !conflict && !uncertain

  useEffect(() => {
    if (!canResolveMunicipalities || !municipalityTenant) return
    const missing = draft.addresses.filter(address => !address.municipalityCode?.trim() && /^\d{8}$/.test(address.postalCode.replace(/\D/g, "")) && address.city.trim() && address.state.length === 2)
    if (!missing.length) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void Promise.all(missing.map(async address => {
        try {
          const code = await lookupMunicipalityCode({ ...address, taxId: "", cityName: address.city, municipalityCode: address.municipalityCode || "" }, municipalityTenant, controller.signal, erpFetch)
          return { address, code }
        } catch { return { address, code: null } }
      })).then(results => {
        if (controller.signal.aborted || pending.current) return
        // Automatic enrichment remains part of the address supplied by the CNPJ lookup.
        const generated = cnpjProvenance.current.address
        const generatedCode = results.find(result => result.address === generated)?.code
        if (generated && generatedCode) cnpjProvenance.current.address = { ...generated, municipalityCode: generatedCode }
        setDraft(current => {
          let changed = false
          const addresses = current.addresses.map(address => {
            const code = results.find(result => result.address === address)?.code
            if (!code || address.municipalityCode?.trim()) return address
            changed = true
            return { ...address, municipalityCode: code }
          })
          return changed ? { ...current, addresses } : current
        })
        if (results.some(result => result.code)) setSaved(false)
      })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [draft.addresses, municipalityTenant, canResolveMunicipalities])

  useEffect(() => {
    const controller = new AbortController()
    erpFetch(id ? `/api/erp/parties/${id}` : "/api/erp/parties?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      const input = id ? values(value.data) : { ...blank }
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: id ? value.data : undefined })
      setDraft(input); setBaseline(JSON.stringify(input)); setEtag(response.headers.get("etag") || "")
      cnpjProvenance.current = emptyCnpjProvenance()
      setError(""); setConflict(false); setUncertain(false); command.current = null
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry])

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, uncertain])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || pending.current || conflict || view) return
    pending.current = true; setSaving(true); setSaved(false); setError("")
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body: JSON.stringify(draft) }
    try {
      const response = await erpFetch(id ? `/api/erp/parties/${id}` : "/api/erp/parties", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) },
        body: id ? JSON.stringify(draft) : command.current!.body,
      })
      const value = await response.json()
      if (!response.ok) {
        setError(value.title || "Não foi possível salvar")
        if (id) setConflict(response.status === 412 || response.status >= 500)
        else setUncertain(response.status >= 500)
        return
      }
      if (!response.headers.get("etag") || !value.data?.id) throw new Error("Confirmação incompleta")
      const input = values(value.data)
      setUncertain(false); command.current = null; setDraft(input); setBaseline(JSON.stringify(input)); setSaved(true)
      cnpjProvenance.current = emptyCnpjProvenance()
      if (!id) router.replace(`/cadastros/clientes-fornecedores/${value.data.id}`)
      else { setSnapshot(value); setEtag(response.headers.get("etag")!) }
    } catch {
      setError("Não foi possível confirmar a gravação. Sua edição foi preservada.")
      if (id) setConflict(true); else setUncertain(true)
    } finally { pending.current = false; setSaving(false) }
  }

  function reload() {
    if (!dirty || window.confirm("Descartar sua edição e carregar o cadastro atual do servidor?")) { setLoading(true); setRetry(value => value + 1); setSaved(false) }
  }
  function change<K extends keyof PartyInput>(field: K, value: PartyInput[K]) {
    const provenance = cnpjProvenance.current
    const documentChanged = field === "personType" && value !== draft.personType || field === "taxId" && String(value).replace(/[.\s/-]/g, "").toUpperCase() !== draft.taxId.replace(/[.\s/-]/g, "").toUpperCase()
    if (documentChanged) cnpjProvenance.current = emptyCnpjProvenance()
    else if (field === "addresses") provenance.address = null
    else if (["legalName", "tradeName", "email", "phone"].includes(field)) delete provenance.fields[field as keyof typeof provenance.fields]
    setDraft(current => ({ ...(documentChanged ? clearPartyCnpj(current, provenance) : current), [field]: value }))
    setSaved(false)
  }

  return <>
    <PageHeader eyebrow="Cadastros · Clientes e fornecedores" title={view ? snapshot?.data?.legalName || "Pessoa" : id ? "Editar pessoa" : "Nova pessoa"} />
    <section className="compact-records form-section min-w-0 space-y-3">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Button onClick={reload}>Tentar novamente</Button></> : <>
        <RecordCompany key={snapshot.tenantId} tenantId={snapshot.tenantId} />
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar clientes e fornecedores.</p>}
        {saved && <p role="status">Pessoa salva no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view && snapshot.data ? <>
          <dl className="grid min-w-0 grid-cols-2 gap-2">{[["Tipo", draft.personType === "fisica" ? "Pessoa física" : "Pessoa jurídica"], ["CPF ou CNPJ", draft.taxId], ["Nome fantasia", draft.tradeName || "Não informado"], ["E-mail", draft.email || "Não informado"], ["Telefone", draft.phone || "Não informado"], ["Relacionamento", relationship(draft)], ["Situação", draft.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div className={`min-w-0 ${label === "E-mail" ? "col-span-2" : ""}`} key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
          <PartyComplements addresses={draft.addresses} contacts={draft.contacts} />
          {snapshot.canEdit && <Link className={linkClass} href={`/cadastros/clientes-fornecedores/${id}/editar`}>Editar pessoa</Link>}
        </> : <form className="space-y-3" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid min-w-0 grid-cols-2 gap-2">
            <label className="min-w-0 space-y-1">Tipo de pessoa<select className={selectClass} value={draft.personType} onChange={event => change("personType", event.target.value)}><option value="juridica">Pessoa jurídica</option><option value="fisica">Pessoa física</option></select></label>
            <label className="min-w-0 space-y-1">Situação<select className={selectClass} value={draft.status} onChange={event => change("status", event.target.value)}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label>
            <div className="col-span-2 min-w-0">{draft.personType === "juridica" ? <RegistryLookup documentField={<label className="block min-w-0 space-y-1"><span>CPF ou CNPJ</span><Input required value={draft.taxId} maxLength={30} onChange={event => change("taxId", event.target.value)} /></label>} kind="cnpj" context="party" tenantId={snapshot.tenantId} automaticValue={draft.taxId} disabled={!snapshot.canEdit || saving || uncertain || conflict} readValue={() => draft.taxId} onApply={fields => {
              const result = fillPartyCnpj(draft, fields, cnpjProvenance.current)
              if (!result.count) return 0
              cnpjProvenance.current = result.provenance
              setDraft(result.draft)
              setSaved(false)
              return result.count
            }} /> : <label className="block min-w-0 space-y-1"><span>CPF ou CNPJ</span><Input required value={draft.taxId} maxLength={30} onChange={event => change("taxId", event.target.value)} /></label>}</div>
            {([ ["legalName", "Nome ou razão social", 200], ["tradeName", "Nome fantasia", 200], ["phone", "Telefone", 40], ["email", "E-mail", 254] ] as const).map(([field, label, maximum]) => <label className={`min-w-0 space-y-1 ${field === "legalName" || field === "email" ? "col-span-2" : ""}`} key={field}>{label}<Input required={field === "legalName"} type={field === "email" ? "email" : "text"} value={draft[field] || ""} maxLength={maximum} onChange={event => change(field, event.target.value || (field === "legalName" ? "" : null))} /></label>)}

            <div className="col-span-2 min-w-0 space-y-1"><p className="text-xs font-medium">Relacionamento comercial</p><div className="flex flex-wrap gap-x-5 gap-y-1"><label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={draft.isCustomer} onChange={event => change("isCustomer", event.target.checked)} />Cliente</label><label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={draft.isSupplier} onChange={event => change("isSupplier", event.target.checked)} />Fornecedor</label></div></div>
          <PartyComplements tenantId={snapshot.tenantId} addresses={draft.addresses} contacts={draft.contacts} onAddresses={value => change("addresses", value)} onContacts={value => change("contacts", value)} />
          </fieldset>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outra pessoa.</p>}
          <Button type="submit" className="h-9 px-3" disabled={saving || conflict || !snapshot.canEdit || (!dirty && Boolean(id))}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar pessoa"}</Button>
        </form>}
      </>}
    </section>
  </>
}
