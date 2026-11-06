"use client"

import { useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { erpFetch } from "@/lib/api/client"
import { RequestError } from "@/components/feedback/session-recovery"

type Rules = { belowTarget: boolean; freight: boolean; directorAutoApproval: boolean; managerLimit: "profit" | "target" }
type Snapshot = { tenantId: string; revision: number; data: Rules | null }
export function ApprovalSettings() {
  const resource = useResource<Snapshot>("/api/erp/commercial/approval-settings")
  return <main className="mx-auto max-w-3xl space-y-5 px-4 pb-24 pt-6"><PageHeader eyebrow="Preferências / Comercial" title="Regras de aprovação" description="Política da empresa e limites de autoridade para negociações." /><nav className="flex flex-wrap gap-4"><Link href="/preferencias/comercial" className="text-primary underline">Parâmetros por linha</Link><Link href="/vendas/simulador" className="text-primary underline">Simulador</Link></nav>{resource.loading ? <p role="status">Carregando regras…</p> : resource.error ? <p role="alert"><RequestError message={resource.error} status={resource.status} /></p> : resource.value && <Editor key={`${resource.value.tenantId}:${resource.value.revision}`} snapshot={resource.value} etag={resource.etag} reload={resource.reload} />}</main>
}
function Editor({ snapshot, etag, reload }: { snapshot: Snapshot; etag: string; reload: () => void }) {
  const [draft, setDraft] = useState(() => ({ belowTarget: snapshot.data ? String(snapshot.data.belowTarget) : "", freight: snapshot.data ? String(snapshot.data.freight) : "", directorAutoApproval: snapshot.data ? String(snapshot.data.directorAutoApproval) : "", managerLimit: snapshot.data?.managerLimit || "" }))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  useNavigationGuard(dirty ? "Descartar as regras não salvas?" : null)
  return <form className="form-section space-y-5" onSubmit={async event => {
    event.preventDefault(); if (busy || blocked || !etag) return
    setBusy(true); setError("")
    try {
      const body: Rules = { belowTarget: draft.belowTarget === "true", freight: draft.freight === "true", directorAutoApproval: draft.directorAutoApproval === "true", managerLimit: draft.managerLimit as Rules["managerLimit"] }
      const response = await erpFetch("/api/erp/commercial/approval-settings", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag }, body: JSON.stringify(body) })
      const value = await response.json()
      if (!response.ok) throw Error(value.title || "Não foi possível salvar.")
      if (value.tenantId !== snapshot.tenantId || value.revision !== snapshot.revision + 1 || !response.headers.get("etag")) throw Error("Confirmação incompleta.")
      setDirty(false); reload()
    } catch (reason) { setBlocked(true); setError(reason instanceof Error ? reason.message : "Resultado não confirmado. Recarregue para conferir.") }
    finally { setBusy(false) }
  }}><p>Desconto acima do livre, entrada abaixo da política e prejuízo sempre exigem aprovação. A diretoria decide negociações com prejuízo; o gerente respeita o limite abaixo.</p>{!snapshot.data && <p role="status">Escolha e salve todas as regras antes de iniciar as simulações desta empresa.</p>}
    <fieldset disabled={busy || blocked} className="space-y-4">{[["belowTarget", "Pedido abaixo da meta precisa de aprovação"], ["freight", "Frete por nossa conta precisa de aprovação"], ["directorAutoApproval", "Diretoria aprova automaticamente a própria negociação fora da política"]].map(([key, label]) => <label key={key} className="grid gap-2">{label}<select required className="min-h-10 rounded-lg border bg-background px-3" value={draft[key as keyof typeof draft]} onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setDirty(true) }}><option value="">Escolha explicitamente</option><option value="true">Sim</option><option value="false">Não</option></select></label>)}
      <label className="grid gap-2">O gerente comercial aprova sozinho<select required className="min-h-10 rounded-lg border bg-background px-3" value={draft.managerLimit} onChange={e => { setDraft({ ...draft, managerLimit: e.target.value }); setDirty(true) }}><option value="">Escolha o limite</option><option value="profit">Qualquer pedido que ainda dê lucro</option><option value="target">Somente pedidos dentro da meta</option></select></label><Button type="submit" disabled={!dirty}>Salvar regras</Button>
    </fieldset><p className="text-sm text-muted-foreground">As permissões de gerente e diretoria são atribuídas em Usuários e perfis. Salvar estas regras não concede autoridade a nenhum usuário.</p>{error && <p role="alert">{error} Sua edição foi preservada.</p>}{blocked && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar edição e recarregar as regras salvas?")) { setDirty(false); reload() } }}>Recarregar regras</Button>}</form>
}
