"use client"

import { useRegistryQuery } from "@/features/records/use-registry-query"
import { useResource } from "@/hooks/use-operation"
import { Pagination } from "@/components/workspace/pagination"
import { erpFetch } from "@/lib/api/client"
import { lookupMunicipalityCode } from "@/lib/municipality-code"
import { partySessionEnded } from "@/lib/party-draft-session"

import type { Schema } from "@/lib/api/types"

import { AccessLink } from "@/components/feedback/session-recovery"

import { GuardedLink as Link, useNavigationGuard, useListNavigationHref } from "@/components/shell/navigation-guard"
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
import { clearPartyCnpj, emptyCnpjProvenance, fillPartyCnpj, type PartyDraft, type PartyFiscal } from "./party-cnpj"
import { readPartyDraft, writePartyDraft, recoverPartyDraft, type StoredPartyDraft, type PartyCommand } from "./party-draft"
import "@/features/records/compact-form.css"

type PartyInput = PartyDraft
type Party = Schema<"Party">
type Snapshot = Omit<Schema<"PartySnapshot">, "data"> & { data?: Schema<"Party"> }
type Page = Schema<"PartyList">
const blank: PartyInput = { personType: "juridica", legalName: "", tradeName: null, taxId: "", email: null, phone: null, isCustomer: true, isSupplier: false, status: "active", addresses: [], contacts: [], fiscal: null }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function values(party: Party): PartyInput {
  return { personType: party.personType, legalName: party.legalName, tradeName: party.tradeName, taxId: party.taxId, email: party.email, phone: party.phone, isCustomer: party.isCustomer, isSupplier: party.isSupplier, status: party.status, addresses: party.addresses || [], contacts: party.contacts || [], fiscal: (party as Party & { fiscal?: PartyFiscal | null }).fiscal || null }
}
const fiscalLabels = { "1": "Contribuinte do ICMS", "2": "Contribuinte isento de IE", "9": "Não contribuinte do ICMS" }
function relationship(party: Pick<PartyInput, "isCustomer" | "isSupplier">) { return party.isCustomer && party.isSupplier ? "Cliente e fornecedor" : party.isCustomer ? "Cliente" : "Fornecedor" }

export function PartyList() {
  const { query, navigate } = useRegistryQuery("party")
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
  if (query.role) params.set("role", query.role)
  if (query.status) params.set("status", query.status)
  const resource = useResource<Page>(`/api/erp/parties?${params}`)
  const { value: result, loading, error, status: responseStatus } = resource
  function search(value: typeof query) { if (!navigate(value)) resource.reload() }

  return <>

    <section className="compact-records form-section min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Pessoas cadastradas</h2>{result?.canEdit && <Link className={linkClass} href="/cadastros/clientes-fornecedores/novo">Nova pessoa</Link>}</div>
      <form className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget)
        search({ q: String(form.get("q") || ""), role: String(form.get("role") || ""), status: String(form.get("status") || ""), offset: 0 })
      }}>
        <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><label className="min-w-0 space-y-1">Buscar nome ou documento<SearchInput onSearch={(q, form) => { const fields = form ? new FormData(form) : null; search({ q, role: String(fields?.get("role") || ""), status: String(fields?.get("status") || ""), offset: 0 }) }} name="q" defaultValue={query.q} maxLength={160} placeholder="Documento sem máscara" /></label><Button className="h-9 px-3" type="submit" disabled={loading}>Buscar</Button></div>
        <label className="min-w-0 space-y-1">Relacionamento<select key={query.role} name="role" defaultValue={query.role} className={selectClass}><option value="">Todos</option><option value="customer">Clientes</option><option value="supplier">Fornecedores</option></select></label>
        <label className="min-w-0 space-y-1">Situação<select key={query.status} name="status" defaultValue={query.status} className={selectClass}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
      </form>
      {loading ? <p role="status">Carregando pessoas…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p>{responseStatus === 401 && <AccessLink className={linkClass}>Entrar com Avila Ops</AccessLink>}<Button variant="outline" onClick={resource.reload}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} pessoa(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de clientes e fornecedores" tabIndex={0}><DataTable aria-label="Clientes e fornecedores" className="table-fixed lg:table-auto">
          <thead><tr><th scope="col" className="w-[55%] lg:w-auto">Nome</th><th scope="col" className="hidden lg:table-cell">CPF / CNPJ</th><th scope="col" className="hidden lg:table-cell">Relacionamento</th><th scope="col">Contato</th><th scope="col" className="hidden lg:table-cell">Situação</th></tr></thead>
          <tbody>{result.data.map(party => <tr key={party.id}>
            <th scope="row" className="align-top font-medium"><Link className={`${linkClass} line-clamp-2 [overflow-wrap:anywhere] lg:line-clamp-none`} title={party.legalName} href={`/cadastros/clientes-fornecedores/${party.id}`}>{party.legalName}</Link><div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground lg:hidden"><p className="[overflow-wrap:anywhere]">{party.taxId}</p><p>{relationship(party)}</p><p>{party.status === "active" ? "Ativo" : "Arquivado"}</p></div></th>
            <td className="hidden whitespace-nowrap lg:table-cell">{party.taxId}</td><td className="hidden lg:table-cell">{relationship(party)}</td><td className="align-top [overflow-wrap:anywhere]">{party.email && <p>{party.email}</p>}{party.phone && <p className="mt-1 text-xs text-muted-foreground">{party.phone}</p>}{!party.email && !party.phone && "Não informado"}</td><td className="hidden lg:table-cell">{party.status === "active" ? "Ativo" : "Arquivado"}</td>
          </tr>)}</tbody>
        </DataTable></div> : <p>Nenhuma pessoa encontrada.</p>}
        <Pagination offset={query.offset} pageSize={25} total={result.total} onOffsetChange={offset => search({ ...query, offset })} />
      </>}
    </section>
  </>
}

export function PartyEditor({ id, view = false, draftScope, tenantId }: { id?: string; view?: boolean; draftScope: string; tenantId: string }) {
  const router = useRouter()
  const listHref = useListNavigationHref()
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
  const command = useRef<PartyCommand | null>(null)
  const cnpjProvenance = useRef(emptyCnpjProvenance())
  const active = useRef(true)
  const draftSessionActive = useRef(true)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [storageError, setStorageError] = useState("")
  const [storageInvalid, setStorageInvalid] = useState(false)
  const storageKey = `erp:party-draft:v1:${draftScope}:${id || "new"}`
  const dirty = JSON.stringify(draft) !== baseline
  useNavigationGuard(!view && (dirty || uncertain || saving || storageInvalid) ? "Há uma edição de pessoa pendente. Sair desta tela sem concluir a gravação?" : null)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const end = () => {
      draftSessionActive.current = false
      command.current = null
      setSessionEnded(true)
      setError("A sessão terminou. O rascunho pessoal foi removido desta aba; entre novamente para continuar.")
    }
    window.addEventListener(partySessionEnded, end)
    return () => window.removeEventListener(partySessionEnded, end)
  }, [])
  const municipalityTenant = snapshot?.tenantId
  const canResolveMunicipalities = !view && !loading && snapshot?.canEdit && !saving && !conflict && !uncertain && !sessionEnded

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
      if (!draftSessionActive.current) return
      if (value.tenantId !== tenantId) throw new Error("A empresa da sessão mudou. Reabra o cadastro.")
      if (id && (value.data?.id !== id || !Number.isSafeInteger(value.data?.revision) || response.headers.get("etag") !== `"${value.data.revision}"`)) throw new Error("Identificação ou revisão do cadastro não recebida")
      const input = id ? values(value.data) : { ...blank }
      const serverEtag = response.headers.get("etag") || ""
      const stored = !view && value.canEdit ? readPartyDraft(storageKey) : { value: null, error: "" }
      const recovery = recoverPartyDraft(stored.value, input, serverEtag, !!id)
      const local = recovery.value
      setStorageInvalid(!!stored.error); setStorageError(stored.error); setRecovered(!!local)
      if (recovery.confirmed && !writePartyDraft(storageKey, null)) setStorageError("Cadastro conferido, mas não foi possível limpar o rascunho desta aba.")
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: id ? value.data : undefined })
      setDraft(local?.draft || input); setBaseline(local?.baseline || JSON.stringify(input)); setEtag(local?.etag || serverEtag)
      cnpjProvenance.current = local?.provenance || emptyCnpjProvenance()
      setError(local?.conflict ? "A gravação anterior ou a revisão do cadastro precisa ser conferida. Sua edição foi recuperada; recarregue para consultar o servidor." : "")
      setConflict(!!local?.conflict); setUncertain(!!local?.uncertain); command.current = local?.command || null; setSaved(recovery.confirmed)
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry, storageKey, tenantId, view])

  useEffect(() => {
    if (loading || view || !snapshot?.canEdit || storageInvalid || saving || !draftSessionActive.current) return
    const value: StoredPartyDraft | null = dirty || uncertain || conflict ? { version: 1, draft, baseline, etag, uncertain, conflict, command: uncertain || conflict ? command.current : null, provenance: cnpjProvenance.current } : null
    if (!writePartyDraft(storageKey, value)) setStorageError("Não foi possível proteger o rascunho nesta aba. Libere o armazenamento do navegador antes de sair ou salvar.")
    else setStorageError("")
  }, [draft, baseline, etag, dirty, uncertain, conflict, saving, loading, snapshot, storageKey, storageInvalid, view])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || pending.current || conflict || view || storageInvalid || !draftSessionActive.current) return
    if (!uncertain) command.current = { key: crypto.randomUUID(), body: JSON.stringify(draft) }
    if (!command.current) { setError("Comando de gravação não recuperado. Confira o cadastro antes de continuar."); return }
    const protectedDraft: StoredPartyDraft = { version: 1, draft, baseline, etag, uncertain: !id, conflict: !!id, command: command.current, provenance: cnpjProvenance.current }
    if (!writePartyDraft(storageKey, protectedDraft)) { if (!uncertain) command.current = null; setStorageError("Não foi possível proteger a gravação nesta aba. Libere o armazenamento do navegador e tente novamente."); return }
    pending.current = true; setSaving(true); setSaved(false); setError("")
    try {
      const response = await erpFetch(id ? `/api/erp/parties/${id}` : "/api/erp/parties", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) },
        body: command.current.body,
      })
      const value = await response.json()
      if (!active.current || !draftSessionActive.current) return
      if (!response.ok) {
        setError(value.title || "Não foi possível salvar")
        if (id) { setConflict(response.status === 412 || response.status >= 500); if (response.status !== 412 && response.status < 500) command.current = null }
        else { setUncertain(uncertain || response.status >= 500); if (!uncertain && response.status < 500) command.current = null }
        return
      }
      if (value.tenantId !== tenantId || !/^[0-9a-f-]{36}$/i.test(value.data?.id || "") || id && value.data.id !== id || !Number.isSafeInteger(value.data?.revision) || value.data.revision < 1 || response.headers.get("etag") !== `"${value.data.revision}"`) throw new Error("Confirmação incompleta")
      const input = values(value.data)
      if (!writePartyDraft(storageKey, null)) setStorageError("Pessoa salva. Não foi possível limpar o rascunho desta aba; confira o cadastro antes de repetir qualquer gravação.")
      setUncertain(false); setConflict(false); setRecovered(false); command.current = null; setDraft(input); setBaseline(JSON.stringify(input)); setSaved(true)
      cnpjProvenance.current = emptyCnpjProvenance()
      if (!id) router.replace(listHref(`/cadastros/clientes-fornecedores/${value.data.id}`))
      else { setSnapshot(value); setEtag(response.headers.get("etag")!) }
    } catch {
      if (!active.current || !draftSessionActive.current) return
      setError("Não foi possível confirmar a gravação. Sua edição foi preservada.")
      if (id) setConflict(true); else setUncertain(true)
    } finally { pending.current = false; if (active.current) setSaving(false) }
  }

  function reload() {
    if (pending.current) return
    if ((!dirty && !uncertain && !conflict && !storageInvalid) || window.confirm("Descartar o rascunho desta aba e carregar o cadastro atual do servidor? Uma gravação pendente deve ser conferida antes de criar outra pessoa.")) {
      if (!writePartyDraft(storageKey, null)) { setStorageError("Não foi possível descartar o rascunho. Libere o armazenamento do navegador."); return }
      setLoading(true); setRetry(value => value + 1); setSaved(false)
    }
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
      <Link className={linkClass} href="/cadastros/clientes-fornecedores">Voltar às pessoas</Link>
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Button onClick={reload}>Tentar novamente</Button></> : <>
        <RecordCompany key={snapshot.tenantId} tenantId={snapshot.tenantId} />
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar clientes e fornecedores.</p>}
        {saved && <p role="status">Pessoa salva no servidor.</p>}
        {recovered && <p role="status" className="text-sm text-muted-foreground">Edição recuperada nesta aba. Confira os dados antes de salvar.</p>}
        {storageError && <div role="alert" className="space-y-2"><p>{storageError}</p>{storageInvalid && <Button type="button" variant="outline" onClick={reload}>Descartar rascunho e consultar servidor</Button>}</div>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{sessionEnded && <AccessLink />}{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view && snapshot.data ? <>
          <dl className="grid min-w-0 grid-cols-2 gap-2">{[["Tipo", draft.personType === "fisica" ? "Pessoa física" : "Pessoa jurídica"], ["CPF ou CNPJ", draft.taxId], ["Nome fantasia", draft.tradeName || "Não informado"], ["E-mail", draft.email || "Não informado"], ["Telefone", draft.phone || "Não informado"], ["Relacionamento", relationship(draft)], ["Situação", draft.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div className={`min-w-0 ${label === "E-mail" ? "col-span-2" : ""}`} key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
          <PartyComplements addresses={draft.addresses} contacts={draft.contacts} />
          <dl className="grid min-w-0 grid-cols-2 gap-2"><div><dt className="text-xs text-muted-foreground">Classificação ICMS</dt><dd>{draft.fiscal ? fiscalLabels[draft.fiscal.taxpayerIndicator] : "Não informada"}</dd></div><div><dt className="text-xs text-muted-foreground">Inscrição estadual</dt><dd>{draft.fiscal?.stateRegistration || "Não informada"}</dd></div></dl>
          {snapshot.canEdit && <Link className={linkClass} href={`/cadastros/clientes-fornecedores/${id}/editar`}>Editar pessoa</Link>}
        </> : <form className="space-y-3" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain || conflict || storageInvalid || sessionEnded} className="grid min-w-0 grid-cols-2 gap-2">
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
          <fieldset className="col-span-2 grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Dados fiscais</legend><label className="min-w-0 space-y-1">Classificação ICMS<select className={selectClass} value={draft.fiscal?.taxpayerIndicator || ""} onChange={event => { const indicator = event.target.value as PartyFiscal["taxpayerIndicator"] | ""; change("fiscal", indicator ? { taxpayerIndicator: indicator, stateRegistration: indicator === "2" ? null : draft.fiscal?.stateRegistration || null } : null) }}><option value="">Não informada</option>{Object.entries(fiscalLabels).map(([indicator, label]) => <option key={indicator} value={indicator}>{label}</option>)}</select></label><label className="min-w-0 space-y-1">Inscrição estadual<Input inputMode="numeric" maxLength={14} pattern="[0-9]{2,14}" required={draft.fiscal?.taxpayerIndicator === "1"} disabled={!draft.fiscal || draft.fiscal.taxpayerIndicator === "2"} value={draft.fiscal?.stateRegistration || ""} onChange={event => { if (draft.fiscal) change("fiscal", { ...draft.fiscal, stateRegistration: event.target.value || null }) }} /></label><p className="text-xs text-muted-foreground sm:col-span-2">Declare conforme o cadastro fiscal do cliente ou fornecedor. A consulta de CNPJ não define esta classificação.</p></fieldset>
          <PartyComplements tenantId={snapshot.tenantId} addresses={draft.addresses} contacts={draft.contacts} onAddresses={value => change("addresses", value)} onContacts={value => change("contacts", value)} />
          </fieldset>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outra pessoa.</p>}
          <Button type="submit" className="h-9 px-3" disabled={saving || conflict || storageInvalid || sessionEnded || !snapshot.canEdit || (!dirty && Boolean(id))}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar pessoa"}</Button>
        </form>}
      </>}
    </section>
  </>
}
