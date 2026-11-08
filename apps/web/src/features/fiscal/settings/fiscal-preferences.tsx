"use client"
import { PageTitle } from "@/components/workspace/page-title"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"

export type OperationNature = { id: string; code: string; name: string; direction: string; purpose: number; model: number; internalCfop: string; interstateCfop: string; foreignCfop: string; active: boolean }
type Nfce = { environment: string; state: string; series: number | ""; nextNumber: number | ""; cscId: string; cscConfigured?: boolean }
type AuthorizedXmlPerson = { id: string; name: string; email: string; taxId: string; role: string; active: boolean }
type Delivery = { notificationEmail: string; authorizedPeople: AuthorizedXmlPerson[] }
type Data = Nfce | { items: OperationNature[] } | Delivery
type Snapshot = { tenantId: string; revision: number; canEdit: boolean; secretStorageAvailable: boolean; data: Data | null }
const emptyNfce: Nfce = { environment: "", state: "", series: "", nextNumber: "", cscId: "" }
const emptyDelivery: Delivery = { notificationEmail: "", authorizedPeople: [] }
const selectClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm"

export function FiscalPreferences({ section }: { section: "nfce" | "operation-natures" | "delivery" }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<Data>(section === "nfce" ? emptyNfce : section === "delivery" ? emptyDelivery : { items: [] })
  const [baseline, setBaseline] = useState("")
  const [csc, setCsc] = useState("")
  const [etag, setEtag] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef(false)
  const dirty = !!snapshot && (JSON.stringify(draft) !== baseline || !!csc)
  const endpoint = `/api/erp/fiscal/settings/${section}`
  const title = section === "nfce" ? "Configurações de NFC-e" : section === "delivery" ? "E-mail e acesso ao XML" : "Naturezas de operação"
  useEffect(() => {
    const controller = new AbortController()
    erpFetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json() as Snapshot & { title?: string }
      if (!response.ok) throw new Error(value.title || "Não foi possível consultar a configuração fiscal")
      const version = response.headers.get("etag")
      if (!version || !value.tenantId) throw new Error("Resposta sem empresa ou revisão")
      if (controller.signal.aborted) return
      const raw = value.data as Partial<Delivery> | null
      const data = section === "nfce"
        ? (value.data || { ...emptyNfce }) as Nfce
        : section === "delivery"
          ? { notificationEmail: raw?.notificationEmail ?? "", authorizedPeople: raw?.authorizedPeople ?? [] }
          : (value.data || { items: [] }) as { items: OperationNature[] }
      setSnapshot(value); setDraft(data); setBaseline(JSON.stringify(data)); setEtag(version); setCsc(""); setError(""); setBlocked(false)
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setSnapshot(null) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [endpoint, reload, section])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || blocked || pending.current) return
    pending.current = true; setSaving(true); setError(""); setNotice("")
    try {
      const body = section === "nfce" ? { environment: nfce.environment, state: nfce.state, series: nfce.series, nextNumber: nfce.nextNumber, cscId: nfce.cscId, ...(csc ? { csc } : {}) } : section === "delivery" ? { notificationEmail: delivery.notificationEmail.trim() || null, authorizedPeople: delivery.authorizedPeople } : draft
      const response = await erpFetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag }, body: JSON.stringify(body) })
      const value = await response.json()
      if (!response.ok) {
        if ([401,403,409,412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw new Error(value.title || "Não foi possível salvar a configuração")
      }
      const version = response.headers.get("etag")
      if (!version || value.tenantId !== snapshot.tenantId || !value.data) { setBlocked(true); throw new Error("Recarregue para conferir a gravação") }
      setSnapshot(value); setDraft(value.data); setBaseline(JSON.stringify(value.data)); setEtag(version); setCsc(""); setNotice("Configuração salva no servidor.")
    } catch (reason) {
      if (reason instanceof TypeError) setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação")
    } finally { pending.current = false; setSaving(false) }
  }
  const nfce = draft as Nfce
  const items = "items" in draft ? draft.items : []
  const delivery = draft as Delivery
  const people = "authorizedPeople" in draft ? draft.authorizedPeople : []
  const updateNature = (index: number, patch: Partial<OperationNature>) => setDraft({ items: items.map((item, i) => i === index ? { ...item, ...patch } : item) })
  const updatePerson = (index: number, patch: Partial<AuthorizedXmlPerson>) => setDraft({ ...delivery, authorizedPeople: people.map((person, i) => i === index ? { ...person, ...patch } : person) })
  return <main className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <Link href="/preferencias?categoria=notas-fiscais" className="text-primary underline" onClick={event => { if (dirty && !window.confirm("Descartar as alterações não salvas?")) event.preventDefault() }}>Voltar às preferências</Link>
    <header><PageTitle className="text-3xl font-semibold">{title}</PageTitle><p className="mt-3 text-sm text-muted-foreground">Configuração da empresa ativa. Preencha os dados conforme as instruções do responsável fiscal.</p></header>
    {loading && <p role="status">Carregando configuração…</p>}
    {snapshot && <form className="space-y-6" onSubmit={save}>
      <fieldset disabled={!snapshot.canEdit || saving || blocked} className="min-w-0 space-y-6">
        {section === "nfce" ? <section className="form-section space-y-4">
          <h2 className="text-lg font-semibold">Ambiente e identificação</h2>
          <p className="text-sm text-muted-foreground">O CSC é exclusivo do ambiente e da empresa. O código salvo fica criptografado e não volta na consulta. Salvar não transmite cupons; a emissão modelo 65 usa o rascunho fiscal e só fica disponível quando o ambiente, certificado, motor e regras fiscais estiverem prontos.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">Ambiente<select aria-label="Ambiente" className={selectClass} required value={nfce.environment} onChange={event => setDraft({ ...nfce, environment: event.target.value })}><option value="">Selecione</option><option value="homologation">Homologação</option><option value="production">Produção</option></select></label>
            <label className="grid gap-2 text-sm">UF do emitente<Input value={nfce.state} required pattern="[A-Z]{2}" maxLength={2} onChange={event => setDraft({ ...nfce, state: event.target.value.toUpperCase() })} /></label>
            <label className="grid gap-2 text-sm">Série da NFC-e<Input type="number" required min={0} max={999} value={nfce.series} onChange={event => setDraft({ ...nfce, series: event.target.value ? Number(event.target.value) : "" })} /></label>
            <label className="grid gap-2 text-sm">Próximo número da NFC-e<Input type="number" required min={1} max={999999999} value={nfce.nextNumber} onChange={event => setDraft({ ...nfce, nextNumber: event.target.value ? Number(event.target.value) : "" })} /></label>
            <label className="grid gap-2 text-sm">Identificador do CSC<Input required inputMode="numeric" pattern="[0-9]{1,6}" maxLength={6} value={nfce.cscId} onChange={event => setDraft({ ...nfce, cscId: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">Código de segurança do contribuinte (CSC)<Input type="password" autoComplete="new-password" minLength={16} maxLength={36} required={!nfce.cscConfigured} disabled={!snapshot.secretStorageAvailable} value={csc} onChange={event => setCsc(event.target.value)} /><span className="text-xs text-muted-foreground">{nfce.cscConfigured ? "CSC cadastrado. Deixe vazio para preservar; informe novamente ao mudar ambiente, UF ou identificador." : "Informe o código fornecido pela SEFAZ para este ambiente."}</span></label>
          </div>
          {!snapshot.secretStorageAvailable && <p role="alert">O servidor precisa de armazenamento criptografado configurado para receber o CSC.</p>}
        </section> : section === "delivery" ? <section className="space-y-4">
          <div className="form-section space-y-4">
            <h2 className="text-lg font-semibold">E-mail fiscal</h2>
            <p className="text-sm text-muted-foreground">Esta configuração identifica o destinatário fiscal da empresa e registra quem está autorizado a acessar XML. Salvar não envia mensagens nem cria uma fila de entrega.</p>
            <label className="grid max-w-xl gap-2 text-sm">E-mail fiscal para avisos<Input type="email" autoComplete="email" value={delivery.notificationEmail} onChange={event => setDraft({ ...delivery, notificationEmail: event.target.value })} /></label>
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Pessoas autorizadas</h2><p className="text-sm text-muted-foreground">Cada pessoa deve ter e-mail e CPF/CNPJ válidos. A autorização fica limitada à empresa ativa.</p></div><Button type="button" variant="outline" disabled={people.length >= 50} onClick={() => setDraft({ ...delivery, authorizedPeople: [...people, { id: crypto.randomUUID(), name: "", email: "", taxId: "", role: "", active: true }] })}>Adicionar pessoa</Button></div>
            {people.length === 0 && <p>Nenhuma pessoa autorizada cadastrada nesta empresa.</p>}
            {people.map((person, index) => <section className="form-section min-w-0 space-y-4" aria-label={`Pessoa autorizada ${index + 1}`} key={person.id}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Pessoa autorizada {index + 1}</h3><Button type="button" variant="ghost" onClick={() => setDraft({ ...delivery, authorizedPeople: people.filter((_, i) => i !== index) })}>Remover</Button></div><div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">Nome completo<Input required maxLength={120} value={person.name} onChange={event => updatePerson(index, { name: event.target.value })} /></label>
              <label className="grid gap-2 text-sm">E-mail autorizado<Input type="email" required maxLength={254} value={person.email} onChange={event => updatePerson(index, { email: event.target.value })} /></label>
              <label className="grid gap-2 text-sm">CPF ou CNPJ<Input required maxLength={18} value={person.taxId} onChange={event => updatePerson(index, { taxId: event.target.value })} /></label>
              <label className="grid gap-2 text-sm">Função ou relação<Input required maxLength={60} value={person.role} onChange={event => updatePerson(index, { role: event.target.value })} /></label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={person.active} onChange={event => updatePerson(index, { active: event.target.checked })} />Autorização ativa</label>
            </div></section>)}
          </div>
        </section> : <section className="space-y-4">
          <p className="text-sm text-muted-foreground">Cadastre natureza, finalidade e CFOPs sem inferir tributação. Desative os registros que não devem mais ser oferecidos.</p>
          {items.length === 0 && <p>Nenhuma natureza de operação cadastrada nesta empresa.</p>}
          {items.map((item,index) => <section className="form-section min-w-0 space-y-4" aria-label={`Natureza ${index+1}`} key={item.id}><h2 className="text-lg font-semibold">Natureza {index+1}</h2><div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">Código<Input required maxLength={30} value={item.code} onChange={event => updateNature(index,{code:event.target.value})} /></label>
            <label className="grid gap-2 text-sm">Descrição da natureza<Input required maxLength={60} value={item.name} onChange={event => updateNature(index,{name:event.target.value})} /></label>
            <label className="grid gap-2 text-sm">Operação<select aria-label="Operação" required className={selectClass} value={item.direction} onChange={event => updateNature(index,{direction:event.target.value})}><option value="">Selecione</option><option value="outgoing">Saída</option><option value="incoming">Entrada</option></select></label>
            <label className="grid gap-2 text-sm">Modelo<select aria-label="Modelo" className={selectClass} value={item.model} onChange={event => updateNature(index,{model:Number(event.target.value)})}><option value={55}>55 — NF-e</option><option value={65}>65 — NFC-e</option></select></label>
            <label className="grid gap-2 text-sm">Finalidade<select aria-label="Finalidade" className={selectClass} value={item.purpose} onChange={event => updateNature(index,{purpose:Number(event.target.value)})}><option value={1}>Normal</option><option value={2}>Complementar</option><option value={3}>Ajuste</option><option value={4}>Devolução</option></select></label>
            {([['internalCfop','CFOP interno'],['interstateCfop','CFOP interestadual'],['foreignCfop','CFOP exterior']] as const).map(([field,label]) => <label key={field} className="grid gap-2 text-sm">{label}<Input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={item[field]} onChange={event => updateNature(index,{[field]:event.target.value})} /></label>)}
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={item.active} onChange={event => updateNature(index,{active:event.target.checked})} />Ativa</label>
          </div></section>)}
          <Button type="button" variant="outline" disabled={items.length >= 200} onClick={() => setDraft({ items: [...items,{id:crypto.randomUUID(),code:"",name:"",direction:"",purpose:1,model:55,internalCfop:"",interstateCfop:"",foreignCfop:"",active:true}] })}>Adicionar natureza</Button>
        </section>}
      </fieldset>
      {!snapshot.canEdit && <p>Seu acesso permite somente consultar estas configurações.</p>}
      <Button type="submit" disabled={!snapshot.canEdit || saving || blocked || !dirty || section === "nfce" && !snapshot.secretStorageAvailable}>{saving ? "Salvando…" : "Salvar configuração"}</Button>
    </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && <Button variant="outline" onClick={() => { if (!dirty || window.confirm("Descartar a edição e carregar os dados do servidor?")) { setLoading(true); setNotice(""); setReload(value => value+1) } }}>Recarregar dados do servidor</Button>}
  </main>
}
