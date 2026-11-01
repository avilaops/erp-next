"use client"

import { useState, type FormEvent } from "react"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "../../hooks/use-operation"

type ReconciledEffect = { status: string; cancelledCount?: number; stockMovementIds?: string[] }
type ReturnEntry = { id: string; reason: string; occurredOn: string; revision: number; reconciliation?: { commission?: ReconciledEffect | string; production?: ReconciledEffect | string }; fiscalCancellation?: { requested: boolean } }
type Props = {
  kind: "sale" | "purchase"
  id: string
  tenantId: string
  etag: string
  canManage: boolean
  reversed: boolean
  disabled?: boolean
  onSuccess: () => void
  onReload: () => void
}

export function CommercialReturn({ kind, id, tenantId, etag, canManage, reversed, disabled = false, onSuccess, onReload }: Props) {
  const command = useCommand()
  const [reason, setReason] = useState("")
  const [occurredOn, setOccurredOn] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const sale = kind === "sale"
  const endpoint = sale ? `/api/erp/orders/${id}/cancel-completed` : `/api/erp/purchase-receipts/${id}/reverse`
  const history = sale ? `/api/erp/orders/${id}/cancellations` : `/api/erp/purchase-receipts/${id}/reversals`
  const frozen = disabled || command.busy || command.uncertain || command.stale
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!command.uncertain && !window.confirm(sale
      ? "Cancelar integralmente esta venda? O estoque será recomposto, os recebimentos declarados serão estornados e a conta a receber será cancelada. O cancelamento da NF-e será solicitado para processamento separado."
      : "Estornar integralmente este recebimento? Todos os itens serão retirados do estoque disponível, os pagamentos declarados serão estornados e a conta a pagar será cancelada.")) return
    const response = await command.send<{ data: ReturnEntry }>(endpoint, tenantId, { reason: reason.trim(), occurredOn }, etag)
    if (response) onSuccess()
  }
  return <section className="min-w-0 space-y-4 border-t pt-5" aria-label={sale ? "Cancelamento integral da venda" : "Estorno integral do recebimento"}>
    {!reversed && <>
      <h3 className="font-semibold">{sale ? "Cancelar venda concluída" : "Estornar recebimento"}</h3>
      <p className="text-sm text-muted-foreground">{sale
        ? "Recompõe o estoque, estorna os recebimentos declarados e cancela a conta a receber. A NF-e permanece com sua situação fiscal até o processamento e a confirmação do cancelamento."
        : "Retira do estoque todos os itens deste recebimento, estorna os pagamentos declarados e cancela a conta a pagar. É necessário saldo disponível sem comprometer reservas de vendas."}</p>
      {canManage ? <form className="space-y-4" onSubmit={submit}>
        <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 space-y-2">{sale ? "Motivo do cancelamento integral" : "Motivo do estorno do recebimento"}<Input required minLength={15} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label className="min-w-0 space-y-2">{sale ? "Data do cancelamento integral" : "Data do estorno do recebimento"}<Input required type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
        </fieldset>
        <p className="text-sm text-muted-foreground">O estorno ajusta os registros declarados. Nenhuma transferência bancária é realizada.</p>
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.uncertain && <p role="status">Resultado ainda não confirmado. Confira novamente: o motivo, a data e o comando original foram preservados.</p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Descartar o motivo e a data em edição e recarregar os dados atuais?")) { command.reset(); onReload() } }}>Recarregar dados atuais</Button>}
        <Button className="h-auto max-w-full whitespace-normal" type="submit" variant="outline" disabled={disabled || command.busy || command.stale || !etag}>
          {command.busy ? "Confirmando…" : command.uncertain ? sale ? "Conferir cancelamento integral" : "Conferir estorno do recebimento" : sale ? "Confirmar cancelamento integral" : "Confirmar estorno integral do recebimento"}
        </Button>
      </form> : <p>{sale ? "O cancelamento integral exige permissões de vendas, estoque e contas a receber." : "O estorno exige permissões de compras, estoque e contas a pagar."}</p>}
    </>}
    <Button type="button" variant="outline" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>{showHistory ? "Ocultar histórico" : sale ? "Consultar histórico de cancelamento" : "Consultar histórico de estornos"}</Button>
    {showHistory && <ReturnHistory url={history} tenantId={tenantId} />}
  </section>
}

function ReconciliationDetails({ entry }: { entry: ReturnEntry }) {
  const commission = entry.reconciliation?.commission
  const production = entry.reconciliation?.production
  return <>
    {commission && <p className="text-sm">{typeof commission === "string" ? "Este registro anterior não confirma a reconciliação de comissões." : commission.status === "applied" ? "Comissões de recebimentos estornadas. Pagamentos anteriores preservados." : "Sem comissões de recebimentos para estornar."}</p>}
    {production && <p className="text-sm">{typeof production === "string" ? "Este registro anterior não confirma a reconciliação de produção." : production.status === "applied" ? `Produção: ${production.cancelledCount ?? 0} ordem(ns) cancelada(s) e ${production.stockMovementIds?.length ?? 0} consumo(s) estornado(s).` : "Sem ordens de produção para cancelar."}</p>}
    {entry.fiscalCancellation?.requested && <p className="text-sm">Solicitação de cancelamento fiscal registrada. Confira a situação da NF-e.</p>}
  </>
}

function ReturnHistory({ url, tenantId }: { url: string; tenantId: string }) {
  const result = useResource<{ tenantId: string; data: ReturnEntry[] }>(url)
  return <div className="min-w-0 space-y-3" aria-label="Histórico de devoluções">
    {result.loading ? <p role="status">Carregando histórico…</p> : result.error ? <div role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Consultar histórico novamente</Button></div> : result.value?.tenantId !== tenantId ? <p role="alert">A empresa consultada mudou. Recarregue a página.</p> : result.value.data.length ? <ul className="space-y-3">{result.value.data.map(entry => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={entry.id}><p className="break-words font-medium">{entry.reason}</p><p>Data: {entry.occurredOn} · Revisão {entry.revision}</p><ReconciliationDetails entry={entry} /></li>)}</ul> : <p>Nenhuma devolução registrada.</p>}
  </div>
}
