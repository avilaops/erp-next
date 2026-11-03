"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Wallet, ShieldCheck, CalendarDays, History, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { useCommand, useResource } from "@/hooks/use-operation"
import { normalizeDecimal } from "@/lib/decimal-input"
import { RequestError } from "@/components/feedback/session-recovery"

type Settings = { salary: string; pixType: string; pixKey: string; recurring: boolean; businessDay: number; startsOn: string; excludedDates: string[]; bank: string; branch: string; account: string }
type Proposal = { id: string; staffId: string; name: string; kind: "settings" | "payment"; payload: Partial<Settings> & { amount?: string; dueDate?: string; category?: string; note?: string }; baseRevision: number; revision: number; status: string; requestedBy: string; reviewedBy?: string; reason?: string; createdAt: string }
type Payment = { id: string; revision: number; kind: string; competence: string; category: string; note: string; dueDate: string; amount: string; paidAmount: string; status: string }
type Snapshot = { tenantId: string; staffId: string; name: string; revision: number; canEdit: boolean; canApprove: boolean; settings: Settings | null; requests: Proposal[]; payments: Payment[] }
type Queue = { tenantId: string; canEdit: boolean; canApprove: boolean; data: Proposal[]; total: number }
const select = "block h-10 w-full rounded-lg border bg-background px-3 text-sm"
const link = "inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
const money = (raw?: string) => Number(raw || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const label: Record<string, string> = { pending: "Aguardando aprovação", approved: "Aprovado", rejected: "Recusado", cancelled: "Cancelado", open: "Em aberto", paid: "Pagamento declarado" }
const monthNow = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date())
const empty: Settings = { salary: "", pixType: "", pixKey: "", recurring: false, businessDay: 5, startsOn: "", excludedDates: [], bank: "", branch: "", account: "" }

function CommandFeedback({ command }: { command: ReturnType<typeof useCommand> }) {
  return <>{command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}{command.uncertain && <p role="status">Confirmação pendente. Clique novamente para conferir o mesmo comando, sem duplicar o lançamento.</p>}{command.stale && <p role="status">Os dados mudaram. Recarregue antes de continuar.</p>}</>
}

function Decisions({ rows, tenant, canApprove, reload }: { rows: Proposal[]; tenant: string; canApprove: boolean; reload: () => void }) {
  return <div className="space-y-3">{rows.length ? rows.map(row => <Decision key={`${row.id}-${row.revision}`} row={row} tenant={tenant} canApprove={canApprove} reload={reload} />) : <p className="py-4 text-sm text-muted-foreground">Nenhuma solicitação nesta situação.</p>}</div>
}
function Decision({ row, tenant, canApprove, reload }: { row: Proposal; tenant: string; canApprove: boolean; reload: () => void }) {
  const command = useCommand()
  const [reason, setReason] = useState("")
  const [decision, setDecision] = useState(true)
  async function review(event: React.FormEvent) {
    event.preventDefault()
    if (!command.uncertain && !window.confirm(decision ? "Aprovar estes dados financeiros? Pagamentos aprovados geram contas a pagar; nenhuma transferência bancária será feita." : "Recusar esta solicitação?")) return
    const result = await command.send(`/api/erp/staff-payroll/requests/${row.id}/review`, tenant, { approve: decision, reason }, `"${row.revision}"`)
    if (result) reload()
  }
  return <article className="min-w-0 rounded-xl border bg-background p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/cadastros/funcionarios/${row.staffId}`} className={link}>{row.name}<ArrowUpRight className="size-3" /></Link><p className="mt-1 text-sm text-muted-foreground">{row.kind === "settings" ? "Salário e dados de pagamento" : "Pagamento avulso"} · {new Date(row.createdAt).toLocaleDateString("pt-BR")}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{label[row.status] || row.status}</span></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{row.kind === "settings" ? <><div><dt className="text-muted-foreground">Salário proposto</dt><dd className="font-semibold">{money(row.payload.salary)}</dd></div><div><dt className="text-muted-foreground">Recorrência</dt><dd>{row.payload.recurring ? `${row.payload.businessDay}º dia útil` : "Desativada"} · início {row.payload.startsOn}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Pix</dt><dd className="break-all">{row.payload.pixType || "Sem chave"}: {row.payload.pixKey || "Não informado"}</dd></div><div><dt className="text-muted-foreground">Dados bancários</dt><dd>{row.payload.bank || "—"} · Ag. {row.payload.branch || "—"} · Conta {row.payload.account || "—"}</dd></div></> : <><div><dt className="text-muted-foreground">Valor e vencimento</dt><dd className="font-semibold">{money(row.payload.amount)} · {row.payload.dueDate}</dd></div><div><dt className="text-muted-foreground">Categoria</dt><dd>{row.payload.category}</dd></div>{row.payload.note && <p className="break-words">{row.payload.note}</p>}</>}</dl>
    {row.reason && <p className="mt-3 break-words text-sm">Decisão: {row.reason}</p>}
    {canApprove && row.status === "pending" && <form onSubmit={review} className="mt-4 space-y-3 border-t pt-4"><fieldset disabled={command.busy || command.uncertain || command.stale} className="grid gap-3 sm:grid-cols-[180px_1fr]"><label className="space-y-1 text-sm">Decisão<select className={select} value={decision ? "approve" : "reject"} onChange={e => setDecision(e.target.value === "approve")}><option value="approve">Aprovar</option><option value="reject">Recusar</option></select></label><label className="space-y-1 text-sm">Motivo<Input required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label></fieldset><CommandFeedback command={command} /><Button disabled={command.busy || command.stale} type="submit">{command.busy ? "Confirmando…" : command.uncertain ? "Conferir decisão" : "Confirmar decisão"}</Button>{command.stale && <Button type="button" variant="outline" onClick={reload}>Recarregar</Button>}</form>}
  </article>
}

export function StaffPayroll({ id }: { id: string }) {
  const resource = useResource<Snapshot>(`/api/erp/staff/${id}/payroll`)
  const [tab, setTab] = useState("settings")
  if (resource.loading) return <section className="form-section mt-5"><p role="status">Carregando pagamentos…</p></section>
  if (resource.status === 403) return <section className="form-section mt-5"><h2 className="font-semibold">Pagamentos</h2><p className="mt-2 text-sm text-muted-foreground">Seu perfil permite consultar o cadastro. Dados salariais exigem permissão financeira específica.</p></section>
  if (!resource.value) return <section className="form-section mt-5"><p role="alert"><RequestError message={resource.error} status={resource.status} /></p><Button onClick={resource.reload}>Tentar novamente</Button></section>
  const value = resource.value
  const pending = value.requests.filter(r => r.status === "pending").length
  return <section className="form-section mt-5 space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet className="size-5 text-primary" />Pagamentos do funcionário</h2><p className="mt-1 text-sm text-muted-foreground">Salário, aprovações e histórico ligados ao financeiro.</p></div><Link href="/cadastros/funcionarios/pagamentos" className={link}>Central de pagamentos</Link></div>
    <div role="tablist" aria-label="Pagamentos do funcionário" className="flex flex-wrap gap-2 border-b pb-3">{[["settings", "Salário e Pix"], ["oneoff", "Pagamento avulso"], ["requests", `Solicitações${pending ? ` (${pending})` : ""}`], ["history", "Histórico"]].map(([key, title]) => <Button key={key} role="tab" aria-selected={tab === key} aria-controls={`payroll-${key}`} id={`payroll-tab-${key}`} variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)}>{title}</Button>)}</div>
    <div role="tabpanel" id={`payroll-${tab}`} aria-labelledby={`payroll-tab-${tab}`}>
      {tab === "settings" && <SettingsForm key={value.revision} value={value} reload={() => {resource.reload();setTab("requests")}} />}
      {tab === "oneoff" && <OneOffForm value={value} reload={() => { resource.reload(); setTab("requests") }} />}
      {tab === "requests" && <Decisions rows={value.requests} tenant={value.tenantId} canApprove={value.canApprove} reload={resource.reload} />}
      {tab === "history" && <><p className="mb-4 text-sm text-muted-foreground">Até 200 títulos recentes. O valor pago corresponde aos registros manuais e estornos no financeiro.</p>{!value.payments.length && <p>Nenhum pagamento registrado.</p>}<ul className="space-y-3">{value.payments.map(p => <li key={p.id} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{p.category} · {p.competence.slice(0, 7)}</strong><span className="text-sm">{label[p.status]}</span></div><p className="mt-2 text-sm">Previsto: {money(p.amount)} · Pago: {money(p.paidAmount)} · Vencimento: {p.dueDate}</p>{p.note && <p className="mt-2 text-sm">{p.note}</p>}<Link href={`/financeiro/contas-pagar/${p.id}`} className={`${link} mt-3 text-sm`}>Ver pagamentos e estornos<ArrowUpRight className="size-3" /></Link></li>)}</ul></>}
    </div>
  </section>
}
function SettingsForm({ value, reload }: { value: Snapshot; reload: () => void }) {
  const [draft, setDraft] = useState<Settings>(value.settings || { ...empty, startsOn: `${monthNow()}-01` })
  const [holidays, setHolidays] = useState(draft.excludedDates.join(", "))
  const [sent, setSent] = useState(false)
  const command = useCommand()
  const disabled = !value.canEdit || command.busy || command.uncertain || command.stale
  useEffect(() => { const prevent = (e: BeforeUnloadEvent) => { if (command.uncertain) e.preventDefault() }; window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent) }, [command.uncertain])
  return <form className="space-y-5" onSubmit={async e => {
    e.preventDefault(); const amount = normalizeDecimal(draft.salary); if (!amount) return
    const result = await command.send(`/api/erp/staff/${value.staffId}/payroll/requests`, value.tenantId, { kind: "settings", baseRevision: value.revision, settings: { ...draft, salary: amount, excludedDates: holidays.split(",").map(d => d.trim()).filter(Boolean) } })
    if (result) { setSent(true); reload() }
  }}>
    <div className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-medium">{value.settings ? `Salário aprovado: ${money(value.settings.salary)}` : "Salário ainda não configurado"}</p><p className="mt-1 text-muted-foreground">Alterações de salário, Pix e recorrência só entram em vigor após aprovação. A recorrência cria contas a pagar; não movimenta sua conta bancária.</p></div>
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-2 text-sm">Salário (R$)<Input required inputMode="decimal" value={draft.salary} onChange={e => setDraft({ ...draft, salary: e.target.value })} placeholder="0,00" /></label>
      <label className="space-y-2 text-sm">Início da recorrência<Input required type="date" value={draft.startsOn} onChange={e => setDraft({ ...draft, startsOn: e.target.value })} /></label>
      <label className="space-y-2 text-sm">Dia de pagamento<select className={select} value={draft.businessDay} onChange={e => setDraft({ ...draft, businessDay: Number(e.target.value) })}><option value={1}>Primeiro dia útil</option><option value={5}>Quinto dia útil</option></select></label>
      <label className="space-y-2 text-sm">Tipo de chave Pix<select className={select} value={draft.pixType} onChange={e => setDraft({ ...draft, pixType: e.target.value, pixKey: e.target.value ? draft.pixKey : "" })}>{[["", "Sem chave"], ["cpf", "CPF"], ["cnpj", "CNPJ"], ["email", "E-mail"], ["phone", "Telefone"], ["random", "Aleatória"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="space-y-2 text-sm">Chave Pix<Input required={!!draft.pixType} disabled={!draft.pixType || disabled} maxLength={200} value={draft.pixKey} onChange={e => setDraft({ ...draft, pixKey: e.target.value })} /></label>
      {([ ["bank", "Banco"], ["branch", "Agência"], ["account", "Conta e dígito"] ] as const).map(([k, l]) => <label key={k} className="space-y-2 text-sm">{l}<Input maxLength={200} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })} /></label>)}
      <label className="space-y-2 text-sm sm:col-span-2 lg:col-span-3">Feriados a excluir do calendário<Input value={holidays} onChange={e => setHolidays(e.target.value)} placeholder="2026-11-02, 2026-11-20, 2026-12-25" /><span className="block text-xs text-muted-foreground">Sábados e domingos são excluídos. Informe também os feriados aplicáveis, separados por vírgula, no formato AAAA-MM-DD.</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.recurring} onChange={e => setDraft({ ...draft, recurring: e.target.checked })} />Ativar recorrência mensal</label>
    </fieldset>
    <CommandFeedback command={command} />{sent && <p role="status">Solicitação enviada para aprovação.</p>}
    {value.canEdit && <div className="flex gap-2"><Button type="submit" disabled={command.busy || command.stale}>{command.busy ? "Enviando…" : command.uncertain ? "Conferir envio" : "Enviar para aprovação"}</Button>{command.stale && <Button type="button" variant="outline" onClick={reload}>Recarregar</Button>}</div>}
  </form>
}
function OneOffForm({ value, reload }: { value: Snapshot; reload: () => void }) {
  const command = useCommand()
  const [draft, setDraft] = useState({ amount: "", dueDate: "", category: "", note: "" })
  return <form className="space-y-4" onSubmit={async e => { e.preventDefault(); const amount = normalizeDecimal(draft.amount); if (!amount) return; if (await command.send(`/api/erp/staff/${value.staffId}/payroll/requests`, value.tenantId, { kind: "payment", payment: { ...draft, amount } })) reload() }}><p className="text-sm text-muted-foreground">Inclua férias, benefícios, adicionais ou outro pagamento. A aprovação cria um título em Contas a pagar.</p><fieldset disabled={!value.canEdit || command.busy || command.uncertain || command.stale} className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm">Valor (R$)<Input required inputMode="decimal" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} /></label><label className="space-y-2 text-sm">Vencimento<Input required type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label><label className="space-y-2 text-sm">Categoria<Input required maxLength={120} placeholder="Ex.: Férias, vale-transporte" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label><label className="space-y-2 text-sm">Observação<Input maxLength={500} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label></fieldset><CommandFeedback command={command} />{value.canEdit && <Button disabled={command.busy || command.stale} type="submit">{command.uncertain ? "Conferir solicitação" : "Solicitar pagamento"}</Button>}</form>
}
export function PayrollOverview() {
  const [status, setStatus] = useState("pending")
  const [offset, setOffset] = useState(0)
  const [month, setMonth] = useState(monthNow)
  const [message, setMessage] = useState("")
  const result = useResource<Queue>(`/api/erp/staff-payroll?status=${status}&offset=${offset}&limit=25`)
  const command = useCommand()
  return <div className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 pt-6 sm:px-6"><PageHeader eyebrow="Cadastros / Funcionários" title="Pagamentos da equipe" description="Revise solicitações e acompanhe a geração das obrigações mensais." /><Link href="/cadastros/funcionarios" className={link}>Voltar à equipe</Link><div className="grid gap-4 md:grid-cols-2"><section className="form-section space-y-3"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary" />Aprovações</h2><p className="text-sm text-muted-foreground">Salário, Pix e pagamentos avulsos aguardam uma decisão de quem tem permissão para aprovar.</p><label className="block space-y-2 text-sm">Situação<select className={select} value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}>{[["pending", "Aguardando aprovação"], ["approved", "Aprovados"], ["rejected", "Recusados"], ["cancelled", "Cancelados"], ["all", "Todas"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></section><section className="form-section space-y-3"><h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="size-5 text-primary" />Recorrência mensal</h2><p className="text-sm text-muted-foreground">A geração automática reconcilia o mês atual a cada hora. Você também pode gerar uma competência; salários existentes não serão duplicados.</p>{result.value?.canApprove && <form className="space-y-3" onSubmit={async e => { e.preventDefault(); const v = await command.send<{ created: number }>("/api/erp/staff-payroll/generate", result.value!.tenantId, { month }); if (v) { setMessage(`${v.created} conta(s) gerada(s).`); result.reload() } }}><label className="block space-y-1 text-sm">Competência<Input required type="month" value={month} disabled={command.busy || command.uncertain} onChange={e => setMonth(e.target.value)} /></label><Button type="submit" disabled={command.busy}>{command.uncertain ? "Conferir geração" : "Gerar contas do mês"}</Button></form>}<CommandFeedback command={command} />{message && <p role="status">{message}</p>}<Link href="/financeiro/contas-pagar" className={link}>Abrir contas a pagar<ArrowUpRight className="size-3" /></Link></section></div><BulkSalaries /><section className="form-section space-y-4"><h2 className="flex items-center gap-2 font-semibold"><History className="size-5 text-primary" />Solicitações da equipe</h2>{result.loading ? <p role="status">Carregando solicitações…</p> : result.error ? <><p role="alert"><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></> : result.value && <><p className="text-sm text-muted-foreground">{result.value.total} solicitação(ões)</p><Decisions rows={result.value.data} tenant={result.value.tenantId} canApprove={result.value.canApprove} reload={result.reload} /><div className="flex justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(offset - 25)}>Anterior</Button><Button variant="outline" disabled={offset + 25 >= result.value.total} onClick={() => setOffset(offset + 25)}>Próxima</Button></div></>}</section></div>
}

function BulkSalaries() {
 const [open,setOpen]=useState(false)
 return <section className="form-section space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Atualizar salários em lote</h2><p className="mt-1 text-sm text-muted-foreground">Proponha novos valores para funcionários com salário já aprovado. Cada proposta poderá ser aprovada ou recusada separadamente.</p></div><Button variant="outline" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?"Fechar atualização":"Atualizar pagamentos"}</Button></div>{open&&<BulkSalaryForm />}</section>
}
function BulkSalaryForm(){
 const [offset,setOffset]=useState(0)
 const rows=useResource<{tenantId:string;data:{id:string;name:string}[];total:number}>(`/api/erp/staff?role=employee&status=active&offset=${offset}&limit=25`)
 const [changes,setChanges]=useState<Record<string,{staffId:string;baseRevision:number;salary:string}>>({})
 const [message,setMessage]=useState("")
 const [batchVersion,setBatchVersion]=useState(0)
 const command=useCommand()
 return <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(!rows.value)return;const result=await command.send<{ids:string[]}>("/api/erp/staff-payroll/salaries",rows.value.tenantId,{changes:Object.values(changes)});if(result){setMessage(`${result.ids.length} proposta(s) enviada(s). Consulte as aprovações acima.`);setChanges({});setBatchVersion(v=>v+1)}}}>
 {rows.loading?<p role="status">Carregando equipe…</p>:rows.error?<p role="alert">{rows.error}</p>:rows.value?.data.map(row=><BulkSalaryRow key={`${row.id}-${batchVersion}`} id={row.id} name={row.name} disabled={command.busy||command.uncertain||command.stale} onChange={(value)=>setChanges(current=>{const next={...current};if(value)next[row.id]=value;else delete next[row.id];return next})} />)}
 <div className="flex justify-between gap-3"><Button type="button" variant="outline" disabled={!offset||command.uncertain} onClick={()=>setOffset(offset-25)}>Anterior</Button><Button type="button" variant="outline" disabled={offset+25>=(rows.value?.total||0)||command.uncertain} onClick={()=>setOffset(offset+25)}>Próxima</Button></div>
 <CommandFeedback command={command}/>{message&&<p role="status">{message}</p>}<Button type="submit" disabled={!Object.keys(changes).length||command.busy||command.stale}>{command.uncertain?"Conferir envio do lote":`Enviar ${Object.keys(changes).length} alteração(ões)`}</Button>{command.stale&&<Button type="button" variant="outline" onClick={()=>{command.reset();setChanges({});setBatchVersion(v=>v+1);rows.reload()}}>Recarregar salários</Button>}
 </form>
}
function BulkSalaryRow({id,name,disabled,onChange}:{id:string;name:string;disabled:boolean;onChange:(value:{staffId:string;baseRevision:number;salary:string}|null)=>void}){
 const data=useResource<Snapshot>(`/api/erp/staff/${id}/payroll`)
 const [amount,setAmount]=useState("")
 return <div className="grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_130px_160px]"><span className="text-sm font-medium">{name}</span><span className="text-sm text-muted-foreground">{data.loading?"Carregando…":data.value?.settings?money(data.value.settings.salary):"Sem salário aprovado"}</span><label className="text-sm"><span className="sr-only">Novo salário de {name}</span><Input inputMode="decimal" placeholder="Novo valor" disabled={disabled||!data.value?.canEdit||!data.value.settings} value={amount} onChange={e=>{setAmount(e.target.value);const salary=normalizeDecimal(e.target.value);onChange(salary&&data.value?{staffId:id,baseRevision:data.value.revision,salary}:null)}} /></label></div>
}
