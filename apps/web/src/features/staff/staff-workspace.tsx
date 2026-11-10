"use client"

import { Pagination } from "@/components/workspace/pagination"
import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { AccessLink } from "@/components/feedback/session-recovery"

import Link from "next/link"
import Image from "next/image"
import { DataTable } from "@/components/workspace/data-table"
import { staffAssignment } from "./staff-assignment"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { RecordCompany } from "@/components/record-company"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"
import "@/features/records/compact-form.css"

type StaffProfile = { cpf?: string | null; rg?: string | null; birthDate?: string | null; admissionDate?: string | null; documentIssuedOn?: string | null; pis?: string | null; ctps?: string | null; address?: string | null; emergencyPhone?: string | null; photo?: string | null }
type StaffInput = Omit<Schema<"StaffInput">, "profile"> & { profile?: StaffProfile | null }
type Staff = Omit<Schema<"Staff">, "profile"> & { profile?: StaffProfile | null }
type Snapshot = Omit<Schema<"StaffSnapshot">, "data"> & { data?: Schema<"Staff"> }
type Page = Schema<"StaffList">
const blank = (): StaffInput => ({ name: "", jobTitle: null, code: "", email: null, phone: null, isEmployee: true, isSeller: false, status: "active", profile: {} })
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function values(staff: Staff): StaffInput {
  return { name: staff.name, jobTitle: staff.jobTitle || (staff.isSeller ? "Vendedor" : null), code: staff.code, email: staff.email, phone: staff.phone, isEmployee: staff.isEmployee, isSeller: staff.isSeller, status: staff.status, profile: staff.profile || {} }
}

export type StaffKind = "funcionarios"

export function StaffList({ kind }: { kind: StaffKind }) {
  const [query, setQuery] = useState({ q: "", role: "", status: "", offset: 0 })
  const [result, setResult] = useState<Page | null>(null)
  const [error, setError] = useState("")
  const [responseStatus, setResponseStatus] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let requestStatus = 0
    const search = query.q.trim() === "%%" ? "" : query.q
    const params = new URLSearchParams({ q: search, offset: String(query.offset), limit: "25" })
    if (query.role) params.set("role", query.role)
    if (query.status) params.set("status", query.status)
    erpFetch(`/api/erp/staff?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
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
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Equipe cadastrada</h2>{result?.canEdit && <Link className={linkClass} href={`/cadastros/${kind}/novo`}>Novo cadastro</Link>}</div>
      <form className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); setLoading(true)
        setQuery({ q: String(form.get("q") || ""), role: "", status: String(form.get("status") || ""), offset: 0 })
      }}>
        <label className="col-span-2 min-w-0 space-y-1 lg:col-span-1">Buscar nome, código ou cargo<SearchInput onSearch={(q, form) => { const fields = form ? new FormData(form) : null; setLoading(true); setQuery({ q, role: "", status: String(fields?.get("status") || ""), offset: 0 }) }} name="q" maxLength={160} placeholder="Nome, código ou cargo" /></label>
        <Button className="h-9 px-3 lg:order-3" type="submit" disabled={loading}>Buscar</Button>
        <label className="col-span-3 min-w-0 space-y-1 lg:col-span-1 lg:order-2">Situação<select aria-label="Filtrar por situação" name="status" className={`${selectClass} max-w-44`}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Desligados</option></select></label>
      </form>
      {loading ? <p role="status">Carregando equipe…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p>{responseStatus === 401 && <AccessLink className={linkClass}>Entrar com Avila Ops</AccessLink>}<Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} cadastro(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <div className="workspace-list-scroll" role="region" aria-label="Lista de funcionários" tabIndex={0}><DataTable aria-label="Funcionários" className="table-fixed lg:table-auto">
          <thead><tr><th scope="col" className="hidden lg:table-cell">Código</th><th scope="col" className="w-[55%] lg:w-auto">Nome</th><th scope="col" className="hidden lg:table-cell">Cargo</th><th scope="col">Contato</th><th scope="col" className="hidden lg:table-cell">Situação</th></tr></thead>
          <tbody>{result.data.map(staff => <tr key={staff.id}>
            <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{staff.code}</td>
            <th scope="row" className="align-top font-medium"><Link className={`${linkClass} line-clamp-2 [overflow-wrap:anywhere] lg:line-clamp-none`} title={staff.name} href={`/cadastros/funcionarios/${staff.id}`}>{staff.name}</Link><div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground lg:hidden"><p className="[overflow-wrap:anywhere]">{staff.code}</p><p>{staff.jobTitle || (staff.isSeller ? "Vendedor" : "Não informado")}</p><p>{staff.status === "active" ? "Ativo" : "Desligado"}</p></div></th>
            <td className="hidden lg:table-cell">{staff.jobTitle || (staff.isSeller ? "Vendedor" : "Não informado")}</td>
            <td className="align-top [overflow-wrap:anywhere]">{staff.email && <p>{staff.email}</p>}{staff.phone && <p className="mt-1 text-xs text-muted-foreground">{staff.phone}</p>}{!staff.email && !staff.phone && "Não informado"}</td>
            <td className="hidden lg:table-cell">{staff.status === "active" ? "Ativo" : "Desligado"}</td>
          </tr>)}</tbody>
        </DataTable></div> : <p>Nenhum cadastro encontrado.</p>}
        <Pagination offset={query.offset} pageSize={25} total={result.total} onOffsetChange={offset => { setLoading(true); setQuery(value => ({ ...value, offset })) }} />
      </>}
    </section>
  </>
}

export function StaffEditor({ kind, id, view = false }: { kind: StaffKind; id?: string; view?: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<StaffInput>(blank())
  const [baseline, setBaseline] = useState(JSON.stringify(blank()))
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
  const dirty = JSON.stringify(draft) !== baseline

  useEffect(() => {
    const controller = new AbortController()
    erpFetch(id ? `/api/erp/staff/${id}` : "/api/erp/staff?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      const input = id ? values(value.data) : blank()
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: id ? value.data : undefined })
      setDraft(input); setBaseline(JSON.stringify(input)); setEtag(response.headers.get("etag") || "")
      setError(""); setConflict(false); setUncertain(false); command.current = null
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry, kind])

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, uncertain])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || pending.current || conflict || view) return
    if (id && draft.status === "archived" && snapshot.data?.status !== "archived" && !window.confirm("Desligar este funcionário? A recorrência será encerrada e as contas em aberto serão canceladas. Pagamentos já registrados serão preservados.")) return
    pending.current = true; setSaving(true); setSaved(false); setError("")
    const payload = { ...draft, ...staffAssignment(draft.jobTitle, snapshot.data) }
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body: JSON.stringify(payload) }
    try {
      const response = await erpFetch(id ? `/api/erp/staff/${id}` : "/api/erp/staff", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) },
        body: id ? JSON.stringify(payload) : command.current!.body,
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
      if (!id) router.replace(`/cadastros/${kind}/${value.data.id}`)
      else { setSnapshot(value); setEtag(response.headers.get("etag")!) }
    } catch {
      setError("Não foi possível confirmar a gravação. Sua edição foi preservada.")
      if (id) setConflict(true); else setUncertain(true)
    } finally { pending.current = false; setSaving(false) }
  }

  function reload() {
    if (!dirty || window.confirm("Descartar sua edição e carregar o cadastro atual do servidor?")) { setLoading(true); setRetry(value => value + 1); setSaved(false) }
  }
  function change<K extends keyof StaffInput>(field: K, value: StaffInput[K]) { setDraft({ ...draft, [field]: value }); setSaved(false) }

  return <>
    <PageHeader breadcrumbs={[
      { label: "Cadastros", href: "/cadastros" },
      { label: "Funcionários", href: "/cadastros/funcionarios" },
      ...(id ? [{ label: snapshot?.data?.name || "Funcionário", href: `/cadastros/funcionarios/${id}` }] : []),
      ...(!view ? [{ label: id ? "Editar funcionário" : "Novo funcionário" }] : []),
    ]} title={view ? snapshot?.data?.name || "Cadastro" : id ? "Editar cadastro" : "Novo cadastro"} description="Dados pessoais, contatos e cargo da equipe." />
    <Link className={linkClass} href={`/cadastros/${kind}`} onClick={event => { if ((dirty || uncertain) && !window.confirm("Sair sem confirmar esta edição?")) event.preventDefault() }}>Voltar à listagem</Link>
    <section className="compact-records form-section mt-2 min-w-0 space-y-3">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Button onClick={reload}>Tentar novamente</Button></> : <>
        <RecordCompany key={snapshot.tenantId} tenantId={snapshot.tenantId} />
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar funcionários.</p>}
        {saved && <p role="status">Cadastro salvo no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view && snapshot.data ? <>
          {draft.profile?.photo && <Image src={draft.profile.photo} alt={`Foto de ${draft.name}`} width={96} height={96} unoptimized className="size-24 rounded-full object-cover" />}
          <dl className="grid min-w-0 grid-cols-2 gap-2">{[["Código", draft.code], ["Cargo", draft.jobTitle || "Não informado"], ["E-mail", draft.email || "Não informado"], ["Telefone", draft.phone || "Não informado"], ["Situação", draft.status === "active" ? "Ativo" : "Desligado"]].map(([label, value]) => <div className={`min-w-0 ${label === "E-mail" ? "col-span-2" : ""}`} key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
          <dl className="grid grid-cols-2 gap-2">{([ ["cpf", "CPF"], ["rg", "RG"], ["birthDate", "Nascimento"], ["admissionDate", "Admissão"], ["documentIssuedOn", "Emissão do documento"], ["pis", "PIS/PASEP"], ["ctps", "CTPS"], ["address", "Endereço"], ["emergencyPhone", "Contato de emergência"] ] as const).map(([key,label]) => <div key={key} className={`min-w-0 ${key === "address" ? "col-span-2" : ""}`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium [overflow-wrap:anywhere]">{draft.profile?.[key] || "Não informado"}</dd></div>)}</dl>
          {snapshot.canEdit && <Link className={linkClass} href={`/cadastros/${kind}/${id}/editar`}>Editar cadastro</Link>}
        </> : <form className="space-y-3" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid min-w-0 grid-cols-2 gap-2">
            {([ ["name", "Nome", 200], ["code", "Código", 40], ["jobTitle", "Cargo", 120], ["email", "E-mail", 254], ["phone", "Telefone", 40] ] as const).map(([field, label, maximum]) => <label className={`min-w-0 space-y-1 ${field === "name" || field === "email" ? "col-span-2" : ""}`} key={field}>{label}<Input required={field === "name" || field === "code"} type={field === "email" ? "email" : "text"} value={draft[field] || ""} maxLength={maximum} onChange={event => change(field, event.target.value || (field === "name" || field === "code" ? "" : null))} /></label>)}
            <label className="min-w-0 space-y-1">Situação<select aria-label="Situação do cadastro" className={selectClass} value={draft.status} onChange={event => change("status", event.target.value)}><option value="active">Ativo</option><option value="archived">Desligado</option></select></label>
          </fieldset>
          <details className="min-w-0 border-y py-2" open={Object.values(snapshot.data?.profile || {}).some(Boolean)} onInvalidCapture={event => { event.currentTarget.open = true }}>
            <summary className="cursor-pointer text-sm font-medium">Dados pessoais e documentos<span className="ml-2 text-xs font-normal text-muted-foreground">Opcional</span></summary>
            <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="mt-2 grid min-w-0 grid-cols-2 items-end gap-2">
              {([ ["cpf", "CPF", 14], ["rg", "RG", 40], ["birthDate", "Data de nascimento", 10], ["admissionDate", "Data de admissão", 10], ["documentIssuedOn", "Emissão do documento", 10], ["pis", "PIS/PASEP", 40], ["ctps", "CTPS", 40], ["address", "Endereço completo", 500], ["emergencyPhone", "Telefone de emergência", 40] ] as const).map(([key,label,max]) => <label key={key} className={`min-w-0 space-y-1 ${key === "address" || key === "emergencyPhone" ? "col-span-2" : ""}`}>{label}<Input type={key.endsWith("Date") || key === "documentIssuedOn" ? "date" : "text"} maxLength={max} value={draft.profile?.[key] || ""} onChange={e => change("profile", { ...draft.profile, [key]: e.target.value || null })} /></label>)}
              <label className="col-span-2 min-w-0 space-y-1">Foto do funcionário<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {const file=e.target.files?.[0]; if(!file)return; if(file.size>200_000 || !["image/png","image/jpeg","image/webp"].includes(file.type)){setError("Selecione PNG, JPEG ou WebP de até 200 KB.");return} const reader=new FileReader();reader.onload=()=>change("profile",{...draft.profile,photo:String(reader.result)});reader.onerror=()=>setError("Não foi possível ler a foto.");reader.readAsDataURL(file)}} />{draft.profile?.photo && <div className="flex items-center gap-3"><Image src={draft.profile.photo} alt="Prévia da foto" width={72} height={72} unoptimized className="size-18 rounded-full object-cover" /><Button type="button" variant="outline" onClick={()=>change("profile",{...draft.profile,photo:null})}>Remover foto</Button></div>}</label>
            </fieldset>
          </details>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro cadastro.</p>}
          <Button type="submit" className="h-9 px-3" disabled={saving || conflict || !snapshot.canEdit || (!dirty && Boolean(id))}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar cadastro"}</Button>
        </form>}
      </>}
    </section>
    {view && id && snapshot?.data?.isEmployee && <Link className={`${linkClass} mt-5 inline-flex min-h-11 items-center`} href={`/financeiro/contas-pagar?aba=funcionarios&funcionario=${id}`}>Pagamentos em Contas a pagar</Link>}
  </>
}
