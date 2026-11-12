"use client"

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GuardedLink } from "@/components/shell/navigation-guard"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { RegistryLookup } from "@/features/records/registry-lookup"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { Lookup, type Choice } from "./orders"
import type { OrderIssue } from "./order-progress"
import "./order-customer-mobile.css"
import {
  applyOrderCustomerLookup, buildOrderCustomerPayload, clearOrderCustomerGenerated, emptyOrderCustomerDraft,
  formatOrderCustomerValue, normalizeOrderCustomerDocument, orderCustomerDraft, orderCustomerIssues, orderCustomerPayloadEqual, writeOrderCustomer,
  type OrderCustomerCommand, type OrderCustomerDraft, type OrderCustomerField, type OrderCustomerParty,
} from "./order-customer-model"

export type OrderCustomerHandle = {
  read: () => { stateRegistration: string | null }
  save: () => Promise<{ id: string; stateRegistration: string | null } | null>
  focus: (field: string) => void
}
type Props = {
  ref?: Ref<OrderCustomerHandle>; tenantId: string; disabled: boolean; canManage: boolean; onDirty: () => void
  onDestinationChange: (state: string) => void; onTaxpayerChange: (value: boolean) => void
  onBusyChange: (value: boolean) => void; onUncertainChange: (value: boolean) => void
  onProgressChange?: (value: { issues: OrderIssue[]; addressState: string }) => void
}
type ConfirmedCustomer = { id: string; tenantId: string; etag: string; party: OrderCustomerParty }
const selectClass = "h-9 min-h-9 w-full min-w-0 rounded-lg border bg-background px-2"
const addressFields: OrderCustomerField[] = ["postalCode", "state", "city", "street", "number", "district", "complement", "municipalityCode"]
const required = <span aria-hidden="true"> *</span>

export function OrderCustomerForm({ ref, tenantId, disabled, canManage, onDirty, onDestinationChange, onTaxpayerChange, onBusyChange, onUncertainChange, onProgressChange }: Props) {
  const region = useRef<HTMLElement>(null)
  const issueId = useId()
  const [draft, setDraft] = useState(emptyOrderCustomerDraft)
  const currentDraft = useRef(draft)
  const confirmed = useRef<ConfirmedCustomer | null>(null)
  const [selectedName, setSelectedName] = useState("")
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const command = useRef<OrderCustomerCommand | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState("")
  const [focusField, setFocusField] = useState<{ field: string } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(true)
  const progressCallback = useRef(onProgressChange)
  const [documentEdited, setDocumentEdited] = useState(false)
  const [cepRevision, setCepRevision] = useState(0)
  const [cepRetry, setCepRetry] = useState(0)
  const [cepPending, setCepPending] = useState(false)
  const [cepMessage, setCepMessage] = useState("")
  const [cepFailed, setCepFailed] = useState(false)
  const lookupGenerated = useRef<Partial<Record<OrderCustomerField, string>>>({})
  const activeSelection = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const activeTenant = useRef(tenantId)
  const frozen = disabled || loading || busy || uncertain || conflict
  const editable = canManage && !frozen
  const issues = orderCustomerIssues(draft)
  const progressSignature = JSON.stringify({ issues: issues.map(issue => ({ ...issue, field: `customer.${issue.field}`, section: "customer" })), addressState: draft.state })
  useEffect(() => { progressCallback.current = onProgressChange }, [onProgressChange])
  useEffect(() => { progressCallback.current?.(JSON.parse(progressSignature)) }, [progressSignature])

  useEffect(() => { onBusyChange(loading || busy) }, [loading, busy, onBusyChange])
  useEffect(() => { onUncertainChange(uncertain) }, [uncertain, onUncertainChange])
  useEffect(() => () => { generation.current++; activeSelection.current?.abort() }, [])
  useEffect(() => {
    if (activeTenant.current === tenantId) return
    activeTenant.current = tenantId
    generation.current++
    activeSelection.current?.abort()
    confirmed.current = null
    command.current = null
    currentDraft.current = emptyOrderCustomerDraft()
    setDraft(currentDraft.current); setSelectedName(""); setRequestedId(null); setLoading(false)
    setError("A empresa mudou. Selecione o cliente desta empresa."); setFocusField(null); setAttempted(false); setEditorOpen(false); setSearchOpen(true); setUncertain(false); setConflict(false)
    lookupGenerated.current = {}; setCepRevision(0); setCepMessage(""); setDocumentEdited(false)
  }, [tenantId])
  useEffect(() => {
    if (!focusField) return
    const frame = requestAnimationFrame(() => {
      const field = Array.from(region.current?.querySelectorAll<HTMLElement>("[data-order-customer-field]") || []).find(element => element.dataset.orderCustomerField === focusField.field)
      if (field && !field.matches(":disabled")) { field.focus({ preventScroll: true }); field.scrollIntoView({ block: "center" }) }
      else { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: "center" }) }
    })
    return () => cancelAnimationFrame(frame)
  }, [focusField, editorOpen, searchOpen])

  function focus(field: string) {
    setAttempted(true)
    if (field === "selection") setSearchOpen(true)
    else { if (field !== "stateRegistration" || !selectedName) setEditorOpen(true); setSearchOpen(false) }
    setFocusField({ field })
  }

  function applyDraft(next: OrderCustomerDraft, notify = true) {
    const previous = currentDraft.current
    currentDraft.current = next
    setDraft(next)
    if (previous.state !== next.state && next.state) onDestinationChange(next.state)
    if (previous.stateRegistration !== next.stateRegistration || previous.personType !== next.personType) {
      const registration = next.stateRegistration.trim().toUpperCase()
      onTaxpayerChange(next.personType === "juridica" && !!registration && registration !== "ISENTO")
    }
    if (notify) onDirty()
  }

  function change(field: OrderCustomerField, value: string) {
    if (frozen || running.current || !canManage && field !== "stateRegistration") return
    let next = currentDraft.current
    const changingDocument = field === "personType" && value !== next.personType || field === "taxId" && normalizeOrderCustomerDocument(value) !== normalizeOrderCustomerDocument(next.taxId)
    if (changingDocument) {
      next = clearOrderCustomerGenerated(next, lookupGenerated.current)
      lookupGenerated.current = {}
      setDocumentEdited(true)
    } else if (field === "postalCode" && value.replace(/\D/g, "") !== next.postalCode.replace(/\D/g, "")) {
      const generatedAddress = Object.fromEntries(addressFields.filter(key => key !== "postalCode").map(key => [key, lookupGenerated.current[key]]))
      next = clearOrderCustomerGenerated(next, generatedAddress)
      for (const key of addressFields) delete lookupGenerated.current[key]
    }
    delete lookupGenerated.current[field]
    next = { ...next, [field]: value }
    if (field === "state" || field === "city") { next.municipalityCode = ""; delete lookupGenerated.current.municipalityCode }
    if (field === "personType") next.stateRegistration = ""
    setFocusField(null); setError(""); command.current = null
    applyDraft(next)
    if (field === "postalCode" || field === "state" || field === "city" || changingDocument) setCepRevision(revision => revision + 1)
  }

  function applyLookup(fields: Record<string, string>) {
    if (!editable || running.current) return 0
    const previous = currentDraft.current
    const next = applyOrderCustomerLookup(previous, fields)
    const changed = (Object.keys(next) as OrderCustomerField[]).filter(field => previous[field] !== next[field])
    for (const field of changed) lookupGenerated.current[field] = next[field]
    if (changed.length) { setFocusField(null); setError(""); applyDraft(next); if (changed.includes("postalCode") || !next.municipalityCode) setCepRevision(revision => revision + 1) }
    return changed.length
  }

  useEffect(() => {
    if (!editable || !cepRevision || !/^\d{8}$/.test(draft.postalCode.replace(/\D/g, ""))) return
    const controller = new AbortController()
    const captured = { postalCode: draft.postalCode.replace(/\D/g, ""), document: normalizeOrderCustomerDocument(draft.taxId), generation: generation.current }
    const current = () => !controller.signal.aborted && !running.current && activeTenant.current === tenantId && generation.current === captured.generation && currentDraft.current.postalCode.replace(/\D/g, "") === captured.postalCode && normalizeOrderCustomerDocument(currentDraft.current.taxId) === captured.document
    const timer = setTimeout(async () => {
      setCepPending(true); setCepFailed(false); setCepMessage("")
      try {
        const response = await erpFetch("/api/erp/registry-lookups", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify({ kind: "cep", context: "party", value: captured.postalCode }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
        const reply: Schema<"LookupReply"> & { title?: string } = await response.json()
        if (!current()) return
        if (!response.ok) throw Error(reply.title || "Não foi possível consultar o CEP. Continue preenchendo manualmente.")
        if (reply.tenantId !== tenantId || reply.kind !== "cep" || reply.value.replace(/\D/g, "") !== captured.postalCode || reply.status !== "found" || !reply.data || !reply.source || !(Date.parse(reply.expiresAt || "") > Date.now())) throw Error("O CEP não retornou dados atuais. Confira os campos ou tente consultar novamente.")
        const access = await erpFetch("/api/erp/me", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
        const session: Schema<"CurrentAccessResponse"> = await access.json()
        if (!current()) return
        if (!access.ok || session.tenant?.id !== tenantId) throw Error("A empresa da sessão mudou. Recarregue antes de preencher; seus campos foram preservados.")
        if (!(Date.parse(reply.expiresAt || "") > Date.now())) throw Error("A consulta do CEP venceu. Consulte novamente; seus campos foram preservados.")
        const previous = currentDraft.current
        const next = applyOrderCustomerLookup(previous, Object.fromEntries(Object.entries(reply.data.fields).filter(([field]) => addressFields.includes(field as OrderCustomerField))))
        for (const field of addressFields) if (next[field] !== previous[field]) lookupGenerated.current[field] = next[field]
        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          currentDraft.current = next; setDraft(next); onDirty()
          if (next.state !== previous.state && next.state) onDestinationChange(next.state)
        }
        setCepMessage(`Campos vazios conferidos pelo CEP. Fonte: ${reply.source}. Revise o endereço antes de salvar.`)
      } catch (reason) {
        if (current()) { setCepFailed(true); setCepMessage(reason instanceof Error ? reason.message : "Consulta indisponível. Preencha manualmente.") }
      } finally { if (!controller.signal.aborted) setCepPending(false) }
    }, 450)
    return () => { clearTimeout(timer); controller.abort(); setCepPending(false) }
  }, [draft.postalCode, draft.taxId, cepRevision, cepRetry, editable, tenantId, onDirty, onDestinationChange])

  async function selectCustomer(value: Choice) {
    if (disabled || busy || uncertain || running.current) return
    activeSelection.current?.abort()
    const controller = new AbortController()
    activeSelection.current = controller
    const selectedGeneration = ++generation.current
    setRequestedId(value.id); setLoading(true); setError(""); setFocusField(null); setAttempted(false); setConflict(false)
    setCepRevision(0); lookupGenerated.current = {}
    try {
      const response = await erpFetch(`/api/erp/parties/${value.id}`, { signal: controller.signal })
      const reply: Schema<"PartySnapshot"> & { title?: string } = await response.json()
      if (controller.signal.aborted || selectedGeneration !== generation.current || activeTenant.current !== tenantId) return
      if (!response.ok) throw Error(reply.title || "Não foi possível carregar o cliente.")
      const etag = response.headers.get("etag")
      if (reply.tenantId !== tenantId || reply.data?.id !== value.id || !etag || !reply.data.isCustomer || reply.data.status !== "active") throw Error("O cliente não está ativo nesta empresa ou a revisão não foi recebida.")
      const party: OrderCustomerParty = { ...reply.data, addresses: reply.data.addresses || [], contacts: reply.data.contacts || [] }
      confirmed.current = { id: value.id, tenantId, etag, party }
      command.current = null
      setSelectedName(party.legalName); setUncertain(false); setDocumentEdited(false)
      setEditorOpen(false); setSearchOpen(false)
      const next = orderCustomerDraft(party)
      applyDraft(next)
      if (next.state) onDestinationChange(next.state)
      onTaxpayerChange(false)
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Cliente indisponível. Tente selecionar novamente.") }
    finally { if (!controller.signal.aborted && selectedGeneration === generation.current) setLoading(false) }
  }

  function newCustomer() {
    if (!canManage || frozen || running.current) return
    activeSelection.current?.abort(); generation.current++
    confirmed.current = null; command.current = null; lookupGenerated.current = {}
    setRequestedId(null); setSelectedName(""); setDocumentEdited(false); setCepRevision(0); setCepMessage(""); setFocusField(null); setAttempted(false); setError(""); setEditorOpen(true); setSearchOpen(false)
    applyDraft(emptyOrderCustomerDraft())
  }

  function read() {
    setAttempted(true)
    if (loading || requestedId && confirmed.current?.id !== requestedId) throw Error("Selecione novamente o cliente e aguarde a conferência do cadastro.")
    if (conflict) throw Error("Recarregue o cliente para conferir o conflito de revisão antes de continuar.")
    if (!confirmed.current && !canManage) throw Error("Selecione um cliente cadastrado. Seu acesso não permite criar clientes.")
    const validation = orderCustomerIssues(currentDraft.current)[0]
    if (validation) { focus(validation.field); throw Error(validation.message) }
    return { stateRegistration: currentDraft.current.personType === "juridica" ? currentDraft.current.stateRegistration.trim() || null : null }
  }

  async function save() {
    if (running.current || loading) return null
    let terms: ReturnType<typeof read>
    try { terms = read() } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira o cliente."); return null }
    const original = confirmed.current
    const input = buildOrderCustomerPayload(currentDraft.current, original?.party)
    if (!uncertain && original && orderCustomerPayloadEqual(input, original.party)) return { id: original.id, ...terms }
    if (!canManage) { setError("Seu acesso permite usar clientes existentes, mas não alterar o cadastro."); return null }
    running.current = true; setBusy(true); setError("")
    if (!uncertain || !command.current) command.current = { tenantId, id: original?.id, etag: original?.etag || "", key: crypto.randomUUID(), input, body: JSON.stringify(input) }
    const captured = command.current
    const selectedGeneration = generation.current
    try {
      const result = await writeOrderCustomer(captured, erpFetch, uncertain)
      if (activeTenant.current !== tenantId || generation.current !== selectedGeneration) return null
      if (result.status !== "saved") {
        setError(result.message); setUncertain(result.status === "uncertain"); setConflict(result.status === "conflict")
        if (result.status === "error") command.current = null
        return null
      }
      // Commit this identity locally before the parent attempts order creation.
      confirmed.current = { id: result.id, tenantId, etag: result.etag, party: result.party }
      command.current = null
      setSelectedName(result.party.legalName); setRequestedId(result.id); setDocumentEdited(false)
      lookupGenerated.current = {}; setCepRevision(0)
      const next = { ...orderCustomerDraft(result.party), stateRegistration: currentDraft.current.stateRegistration }
      currentDraft.current = next; setDraft(next); setUncertain(false); setConflict(false); setFocusField(null); setEditorOpen(false); setSearchOpen(false)
      return { id: result.id, ...terms }
    } finally { running.current = false; setBusy(false) }
  }

  useImperativeHandle(ref, () => ({ read, save, focus }))
  function validationProps(field: OrderCustomerField) {
    const invalid = attempted && issues.some(issue => issue.field === field)
    return { "data-order-customer-field": field, "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${issueId}-${field}` : undefined }
  }
  function inlineError(field: OrderCustomerField) {
    const issue = attempted && issues.find(issue => issue.field === field)
    return issue ? <span id={`${issueId}-${field}`} className="text-xs text-destructive">{issue.message}</span> : null
  }
  function format(field: OrderCustomerField) {
    if (frozen || running.current) return
    const previous = currentDraft.current[field]
    const next = formatOrderCustomerValue(field, previous, currentDraft.current.personType)
    if (next !== previous) {
      if (lookupGenerated.current[field] === previous) lookupGenerated.current[field] = next
      applyDraft({ ...currentDraft.current, [field]: next }, false)
    }
  }
  function input(field: OrderCustomerField, label: string, maximum: number, mandatory = false, type = "text") {
    return <label className="grid min-w-0 gap-1"><span>{label}{mandatory && required}</span><Input {...validationProps(field)} aria-label={label} name={`order-customer-${field}`} type={type} inputMode={field === "postalCode" ? "numeric" : type === "tel" ? "tel" : type === "email" ? "email" : undefined} required={mandatory} maxLength={maximum} placeholder={field === "stateRegistration" ? "Número ou ISENTO" : undefined} value={draft[field]} disabled={field === "stateRegistration" ? frozen : !editable} onChange={event => change(field, event.target.value)} onBlur={() => format(field)} />{inlineError(field)}</label>
  }
  const registration = draft.personType === "juridica" && <div className="order-customer-registration">
    {input("stateRegistration", "Inscrição estadual", 40, true)}
    <label className="order-customer-exempt"><input type="checkbox" checked={draft.stateRegistration.trim().toUpperCase() === "ISENTO"} disabled={frozen} onChange={event => change("stateRegistration", event.target.checked ? "ISENTO" : "")} /><span>Isento de inscrição estadual</span></label>
    <p className="text-xs text-muted-foreground">IE ou ISENTO será usado nas condições deste pedido.</p>
  </div>
  const documentField = <label className="grid min-w-0 gap-1"><span>{draft.personType === "juridica" ? "CNPJ" : "CPF"}{required}</span><Input {...validationProps("taxId")} aria-label={draft.personType === "juridica" ? "CNPJ" : "CPF"} name="order-customer-taxId" required maxLength={30} inputMode={draft.personType === "fisica" ? "numeric" : "text"} autoCapitalize="characters" value={draft.taxId} disabled={!editable} onChange={event => change("taxId", event.target.value)} onBlur={() => format("taxId")} />{inlineError("taxId")}</label>
  return <section ref={region} tabIndex={-1} aria-label="Cliente" className="order-customer-fields min-w-0">
    <header><h2 className="font-semibold">Cliente</h2><span className="order-customer-completion" role="status">{!selectedName && !editorOpen ? "Selecione ou cadastre um cliente" : issues.length ? `${issues.length} pendência${issues.length === 1 ? "" : "s"}` : "Dados conferidos"}</span></header>
    <div className="order-customer-actions">
      <Button type="button" variant={searchOpen ? "default" : "outline"} disabled={disabled || busy || uncertain || loading} aria-expanded={searchOpen} onClick={() => { setSearchOpen(true); setEditorOpen(false) }}>Buscar cliente</Button>
      {canManage && <Button type="button" variant={!selectedName && editorOpen ? "default" : "outline"} disabled={frozen} onClick={newCustomer}>Cadastrar cliente</Button>}
    </div>
    {searchOpen && <div className={!canManage ? "[&_a]:hidden" : undefined}><Lookup compact hideLabel placeholder="Buscar cliente já cadastrado: nome, CNPJ ou CPF…" endpoint="parties" label="cliente" searchOnly selectedName={selectedName} disabled={disabled || busy || uncertain} choose={value => void selectCustomer(value)} /></div>}
    {loading && <p role="status" className="text-xs">Conferindo cadastro do cliente…</p>}
    {!canManage && <p className="text-xs text-muted-foreground">Selecione um cliente existente. A edição do cadastro exige permissão de gestão de clientes.</p>}
    {selectedName && <div className="order-customer-selected">
      <div><p className="font-medium">{draft.legalName || selectedName}</p><p className="text-sm text-muted-foreground">{formatOrderCustomerValue("taxId", draft.taxId, draft.personType)}</p></div>
      <p className="text-sm">{[draft.responsible, draft.phone, draft.email].filter(Boolean).join(" · ") || "Contato não informado"}</p>
      <div><p className="text-xs text-muted-foreground">Endereço cadastral</p><p className="text-sm">{[draft.street, draft.number, draft.district, draft.city, draft.state, formatOrderCustomerValue("postalCode", draft.postalCode)].filter(Boolean).join(", ") || "Endereço não informado"}</p></div>
      <div className="order-customer-actions"><Button type="button" variant="outline" disabled={disabled || busy || uncertain || loading} onClick={() => { setSearchOpen(true); setEditorOpen(false) }}>Trocar</Button>{canManage && <Button type="button" variant="outline" disabled={frozen} aria-expanded={editorOpen} onClick={() => { setEditorOpen(value => !value); setSearchOpen(false) }}>{editorOpen ? "Fechar edição" : "Editar cadastro"}</Button>}</div>
      {!editorOpen && registration}
    </div>}
    {editorOpen && <>
      {selectedName && <p className="order-customer-edit-note text-sm">Ao salvar o pedido, as alterações serão gravadas no cadastro compartilhado do cliente e valerão para outros pedidos.</p>}
      {!selectedName && <p className="text-xs text-muted-foreground">O novo cadastro será gravado ao salvar o pedido.</p>}
      <fieldset className="order-customer-group"><legend>Identificação</legend>
        <div className="order-person-type" role="group" aria-label="Tipo de cliente"><Button type="button" variant={draft.personType === "juridica" ? "default" : "outline"} aria-pressed={draft.personType === "juridica"} disabled={!editable} onClick={() => change("personType", "juridica")}>Empresa (CNPJ)</Button><Button type="button" variant={draft.personType === "fisica" ? "default" : "outline"} aria-pressed={draft.personType === "fisica"} disabled={!editable} onClick={() => change("personType", "fisica")}>Pessoa física (CPF)</Button></div>
        <div className="order-field-grid">{documentField}
          {draft.personType === "juridica" && <RegistryLookup key={`${tenantId}:${requestedId || "new"}`} kind="cnpj" context="party" tenantId={tenantId} automaticValue={!selectedName || documentEdited ? draft.taxId : undefined} readValue={() => currentDraft.current.taxId} disabled={!editable} onApply={applyLookup} />}
          <div className="order-field-full">{input("legalName", draft.personType === "juridica" ? "Razão social" : "Nome completo", 200, true)}</div>
          {draft.personType === "juridica" && input("tradeName", "Nome fantasia", 200)}
          {registration}
        </div>
      </fieldset>
      <fieldset className="order-customer-group"><legend>Contato</legend><div className="order-field-grid">
        {input("responsible", "Nome do responsável", 200, true)}
        {input("phone", "Celular", 40, true, "tel")}
        {input("email", "E-mail", 254, true, "email")}
      </div></fieldset>
      <fieldset className="order-customer-group order-address-fields"><legend>Endereço cadastral do cliente</legend><p className="text-xs text-muted-foreground">Confira o destino e a modalidade na seção Entrega. A consulta do CEP preenche somente campos vazios.</p><div className="order-field-grid">
        {input("postalCode", "CEP", 10, true)}
        <div className="order-field-full">{input("street", "Endereço", 200, true)}</div>
        {input("number", "Número", 40, true)}
        {input("complement", "Complemento", 200)}
        {input("district", "Bairro", 200, true)}
        <div className="order-customer-city-state order-field-full">{input("city", "Cidade", 200, true)}
          <label className="grid min-w-0 gap-1"><span>UF{required}</span><select {...validationProps("state")} aria-label="UF" name="order-customer-state" required className={selectClass} value={draft.state} disabled={!editable} onChange={event => change("state", event.target.value)}><option value="">Selecione</option>{states.map(state => <option value={state} key={state}>{state}</option>)}</select>{inlineError("state")}</label>
        </div>
      </div>
        {draft.municipalityCode && <p className="text-xs text-muted-foreground">Código IBGE: {draft.municipalityCode}</p>}
        {cepPending && <p role="status" className="text-xs">Consultando endereço pelo CEP…</p>}
        {cepMessage && <p role="status" className="text-xs">{cepMessage}</p>}
        {editable && draft.postalCode.replace(/\D/g, "").length === 8 && (cepFailed || !cepRevision) && <Button type="button" variant="outline" disabled={cepPending} onClick={() => { setCepRevision(revision => revision + 1); setCepRetry(retry => retry + 1) }}>Consultar CEP</Button>}
      </fieldset>
    </>}
    {attempted && issues.length > 0 && <div role="alert" className="order-customer-issues"><p className="font-medium">Confira os dados do cliente</p><ul>{issues.map(issue => <li key={issue.field}><button type="button" className="text-left text-sm text-destructive underline" onClick={() => focus(issue.field)}>{issue.message}</button></li>)}</ul></div>}
    {!canManage && requestedId && attempted && issues.some(issue => issue.field !== "stateRegistration") && <p className="text-xs">O cadastro selecionado está incompleto para criar este pedido. Solicite o preenchimento dos campos obrigatórios a quem gerencia clientes. <GuardedLink className="text-primary underline" href={`/cadastros/clientes-fornecedores/${requestedId}`} target="_blank" rel="noopener noreferrer">Abrir cadastro do cliente</GuardedLink></p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {uncertain && <p role="status" className="text-xs">Cadastro com confirmação pendente. Salvar pedido novamente confere o mesmo comando antes de criar o pedido.</p>}
    {conflict && requestedId && <Button type="button" variant="outline" disabled={loading || busy} onClick={() => void selectCustomer({ id: requestedId, legalName: selectedName })}>Recarregar cliente e descartar esta edição</Button>}
    {busy && <p role="status" className="text-xs">Salvando cadastro antes de criar o pedido…</p>}
  </section>
}
