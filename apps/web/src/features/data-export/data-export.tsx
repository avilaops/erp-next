"use client"

import { useState } from "react"
import { Clock3, Download, FileArchive, LockKeyhole } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"

const entities = ["Clientes e fornecedores", "Produtos", "Pedidos de venda", "Documentos fiscais", "Contas a receber", "Contas a pagar", "Saldo de estoque"]
const history = [
  ["EXP-0042", "Produtos e estoque", "Pronto", "Hoje, 14:31"],
  ["EXP-0041", "Clientes", "Processando", "Hoje, 14:27"],
  ["EXP-0040", "Financeiro", "Falhou", "Ontem, 18:02"],
  ["EXP-0039", "Pedidos", "Expirado", "18 out, 09:10"],
  ["EXP-0038", "Produtos", "Solicitado", "17 out, 16:44"],
]

export function DataExport() {
  const [selected, setSelected] = useState<string[]>(["Produtos"])
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [canIncludeDeleted, setCanIncludeDeleted] = useState(false)
  const [requested, setRequested] = useState(false)
  function toggle(item: string) { setSelected((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]) }

  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Dados" title="Exportação de dados" description="Configure solicitações demonstrativas e acompanhe seus estados. Nenhum arquivo real é gerado." />
    {requested && <div className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">Solicitação simulada criada. Nada foi processado ou enviado.</div>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="form-section"><h2 className="text-lg font-semibold">Conteúdo</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Selecione as entidades incluídas na solicitação.</p><div className="grid gap-3 sm:grid-cols-2">{entities.map((item) => <label className="check-card" key={item}><input type="checkbox" checked={selected.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div>
        <fieldset className="mt-6 border-t border-border pt-5"><legend className="text-sm font-semibold">Filtros</legend><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="field">Data inicial<input type="date" /></label><label className="field">Data final<input type="date" /></label></div></fieldset>
        <div className="mt-6 border-t border-border pt-5"><label className="flex gap-3 rounded-xl border border-border p-4"><input className="mt-0.5 size-4 accent-primary" type="checkbox" checked={includeDeleted} disabled={!canIncludeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} /><span><strong className="block text-sm">Incluir registros excluídos</strong><small className="mt-1 block text-xs text-muted-foreground">Exige permissão adicional e justificativa auditável no backend.</small></span></label>{includeDeleted && <label className="field mt-3">Justificativa<textarea required rows={3} placeholder="Motivo para incluir registros excluídos" /></label>}</div>
      </section>
      <aside className="space-y-4"><section className="rounded-2xl border border-border bg-card p-5"><LockKeyhole className="size-5 text-primary" /><h2 className="mt-3 font-semibold">Proteção futura</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Downloads serão temporários, auditados, criptografados e limitados à empresa ativa.</p><label className="mt-4 flex items-start gap-2 text-sm"><input className="mt-0.5 accent-primary" type="checkbox" checked={canIncludeDeleted} onChange={(event) => { setCanIncludeDeleted(event.target.checked); if (!event.target.checked) setIncludeDeleted(false) }} /><span>Simular permissão para registros excluídos</span></label></section><Button className="w-full" disabled={selected.length === 0 || (includeDeleted && !canIncludeDeleted)} onClick={() => setRequested(true)}><FileArchive />Solicitar exportação</Button></aside>
    </div>
    <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="p-5"><h2 className="font-semibold">Histórico simulado</h2><p className="mt-1 text-sm text-muted-foreground">Estados previstos do processamento assíncrono.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-t border-border text-muted-foreground"><tr><th className="p-4">Solicitação</th><th className="p-4">Conteúdo</th><th className="p-4">Estado</th><th className="p-4">Horário</th><th className="p-4 text-right">Ação</th></tr></thead><tbody>{history.map(([id, content, status, time]) => <tr className="border-t border-border" key={id}><td className="p-4 font-medium">{id}</td><td className="p-4">{content}</td><td className="p-4">{status}</td><td className="p-4 text-muted-foreground"><Clock3 className="mr-1 inline size-3" />{time}</td><td className="p-4 text-right"><Button size="sm" variant="outline" disabled={status !== "Pronto"}><Download />Baixar</Button></td></tr>)}</tbody></table></div></section>
  </div>
}
