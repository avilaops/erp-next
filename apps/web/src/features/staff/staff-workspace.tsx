"use client"

import { AccessLink } from "@/components/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type StaffInput = { name: string; jobTitle: string | null; code: string; email: string | null; phone: string | null; isEmployee: boolean; isSeller: boolean; status: string }
type Staff = StaffInput & { id: string; revision: number }
type Snapshot = { tenantId: string; canEdit: boolean; data?: Staff }
type Page = { tenantId: string; canEdit: boolean; data: Staff[]; total: number }
const blank = (kind: StaffKind): StaffInput => ({ name: "", jobTitle: null, code: "", email: null, phone: null, isEmployee: kind === "funcionarios", isSeller: kind === "vendedores", status: "active" })
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

function values(staff: Staff): StaffInput {
  return { name: staff.name, jobTitle: staff.jobTitle, code: staff.code, email: staff.email, phone: staff.phone, isEmployee: staff.isEmployee, isSeller: staff.isSeller, status: staff.status }
}
function relationship(staff: StaffInput) { return staff.isEmployee && staff.isSeller ? "Funcionário e vendedor" : staff.isEmployee ? "Funcionário" : "Vendedor" }

export type StaffKind = "funcionarios" | "vendedores"

export function StaffList({ kind }: { kind: StaffKind }) {
  const [query, setQuery] = useState({ q: "", role: kind === "funcionarios" ? "employee" : "seller", status: "", offset: 0 })
  const [result, setResult] = useState<Page | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
    if (query.role) params.set("role", query.role)
    if (query.status) params.set("status", query.status)
    fetch(`/api/erp/staff?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Cadastros indisponíveis")
      if (!controller.signal.aborted) { setResult(data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, retry])

  return <>
    <PageHeader eyebrow="Cadastros" title={kind === "funcionarios" ? "Funcionários" : "Vendedores"} description="Cadastros da empresa ativa. Uma pessoa pode exercer as duas funções no mesmo registro." />
    <section className="form-section min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Equipe cadastrada</h2>{result?.canEdit && <Link className={linkClass} href={`/cadastros/${kind}/novo`}>Novo cadastro</Link>}</div>
      <form className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); setLoading(true)
        setQuery({ q: String(form.get("q") || ""), role: String(form.get("role") || ""), status: String(form.get("status") || ""), offset: 0 })
      }}>
        <label className="min-w-0 space-y-2">Buscar nome ou código<Input name="q" maxLength={160} placeholder="Código ou nome" /></label>
        <label className="min-w-0 space-y-2">Função<select name="role" defaultValue={kind === "funcionarios" ? "employee" : "seller"} className={selectClass}><option value="">Todos</option><option value="employee">Funcionários</option><option value="seller">Vendedores</option></select></label>
        <label className="min-w-0 space-y-2">Situação<select aria-label="Filtrar por situação" name="status" className={selectClass}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
        <Button className="self-end" type="submit" disabled={loading}>Buscar</Button>
      </form>
      {loading ? <p role="status">Carregando equipe…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p><AccessLink className={linkClass} >Entrar com Ávila Ops</AccessLink><Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} cadastro(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.data.map(staff => <li key={staff.id} className="min-w-0 rounded-xl border p-4">
          <Link className={`${linkClass} break-words`} href={`/cadastros/${kind}/${staff.id}`}>Consultar {staff.name}</Link>
          <p className="mt-2 break-all text-sm">Código: {staff.code}</p>
          <p className="mt-1 text-sm text-muted-foreground">{relationship(staff)} · {staff.status === "active" ? "Ativo" : "Arquivado"}</p>
        </li>)}</ul> : <p>Nenhum cadastro encontrado.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset - 25 }) }}>Anterior</Button><span className="text-sm">Página {query.offset / 25 + 1}</span><Button variant="outline" disabled={query.offset + 25 >= result.total} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset + 25 }) }}>Próxima</Button></div>
      </>}
    </section>
  </>
}

export function StaffEditor({ kind, id, view = false }: { kind: StaffKind; id?: string; view?: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<StaffInput>(blank(kind))
  const [baseline, setBaseline] = useState(JSON.stringify(blank(kind)))
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
    fetch(id ? `/api/erp/staff/${id}` : "/api/erp/staff?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      const input = id ? values(value.data) : blank(kind)
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
    pending.current = true; setSaving(true); setSaved(false); setError("")
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body: JSON.stringify(draft) }
    try {
      const response = await fetch(id ? `/api/erp/staff/${id}` : "/api/erp/staff", {
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
    <PageHeader eyebrow="Cadastros · Funcionários e vendedores" title={view ? snapshot?.data?.name || "Cadastro" : id ? "Editar cadastro" : "Novo cadastro"} description="Cadastro operacional da equipe. As funções não criam uma conta de acesso nem calculam comissões." />
    <Link className={linkClass} href={`/cadastros/${kind}`} onClick={event => { if ((dirty || uncertain) && !window.confirm("Sair sem confirmar esta edição?")) event.preventDefault() }}>Voltar à listagem</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Button onClick={reload}>Tentar novamente</Button></> : <>
        <p className="break-all text-sm text-muted-foreground">Empresa {snapshot.tenantId}{snapshot.data ? ` · Revisão ${snapshot.data.revision}` : ""}</p>
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar funcionários e vendedores.</p>}
        {saved && <p role="status">Cadastro salvo no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view && snapshot.data ? <>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{[["Código", draft.code], ["Cargo", draft.jobTitle || "Não informado"], ["E-mail", draft.email || "Não informado"], ["Telefone", draft.phone || "Não informado"], ["Funções", relationship(draft)], ["Situação", draft.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
          {snapshot.canEdit && <Link className={linkClass} href={`/cadastros/${kind}/${id}/editar`}>Editar cadastro</Link>}
        </> : <form className="space-y-5" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid min-w-0 gap-5 sm:grid-cols-2">
            <label className="min-w-0 space-y-2">Situação<select aria-label="Situação do cadastro" className={selectClass} value={draft.status} onChange={event => change("status", event.target.value)}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label>
            {([ ["name", "Nome", 200], ["jobTitle", "Cargo", 120], ["code", "Código", 40], ["email", "E-mail", 254], ["phone", "Telefone", 40] ] as const).map(([field, label, maximum]) => <label className="min-w-0 space-y-2" key={field}>{label}<Input required={field === "name" || field === "code"} type={field === "email" ? "email" : "text"} value={draft[field] || ""} maxLength={maximum} onChange={event => change(field, event.target.value || (field === "name" || field === "code" ? "" : null))} /></label>)}
            <div className="min-w-0 space-y-3"><p className="font-medium">Funções na empresa</p><label className="flex items-center gap-2"><input type="checkbox" checked={draft.isEmployee} onChange={event => change("isEmployee", event.target.checked)} />Funcionário</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.isSeller} onChange={event => change("isSeller", event.target.checked)} />Vendedor</label><p className="text-sm text-muted-foreground">Selecione pelo menos uma função.</p></div>
          </fieldset>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro cadastro.</p>}
          <Button type="submit" disabled={saving || conflict || !snapshot.canEdit || (!dirty && Boolean(id))}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar cadastro"}</Button>
        </form>}
      </>}
    </section>
  </>
}
