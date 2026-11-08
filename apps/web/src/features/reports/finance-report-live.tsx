"use client"

import { PageHeader } from "@/components/page-header"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LoadingState, ErrorState, EmptyState } from "@/components/workspace/resource-state"
import { downloadCsv } from "@/lib/csv-export"
import { money, decimal as number, financeExportRows } from "./report-model"
import { useFinanceReport } from "./use-report-data"

export function FinanceReportLive() {
  const { receivables, payables, metrics, rows: combined, loading, error, status, reload } = useFinanceReport()
  function exportCsv() { downloadCsv("relatorio-financeiro.csv", financeExportRows(receivables, payables)) }

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Financeiro" title="Relatório financeiro" description="Saldos pendentes das contas da empresa ativa." back={{ href: "/relatorios", label: "Relatórios" }} actions={<Button disabled={loading || Boolean(error) || !combined.length} variant="outline" onClick={exportCsv}><Download aria-hidden="true" />Exportar CSV</Button>} />
      {loading ? <LoadingState>Carregando contas financeiras…</LoadingState> : error ? <ErrorState title="Não foi possível carregar o relatório" message={error} status={status} onRetry={reload} /> : <>
        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["A receber", money(metrics.toReceive)], ["A pagar", money(metrics.toPay)], ["Títulos a receber", String(metrics.openReceivables)], ["Títulos a pagar", String(metrics.openPayables)]].map(([label, value]) => <div className="rounded-2xl border border-border bg-card p-5" key={label}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>)}</section>
        {!combined.length ? <EmptyState title="Nenhum título encontrado">As contas aparecerão aqui quando forem registradas na empresa ativa.</EmptyState> : <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border p-4"><h2 className="font-semibold">Títulos incluídos</h2><p className="mt-1 text-sm text-muted-foreground">Até 100 registros retornados pelas APIs financeiras.</p></div><div className="divide-y divide-border">{combined.map((item) => <article className="grid gap-2 p-4 sm:grid-cols-[110px_minmax(0,1fr)_170px] sm:items-center" key={`${item.kind}-${item.id}`}><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{item.kind}</span><div><h3 className="text-sm font-medium">{item.party}</h3><p className="text-sm text-muted-foreground">Total {money(number(item.amount))} · saldo {money(number(item.outstandingAmount))} · vencimento {item.dueDate}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{item.status === "open" ? "Em aberto" : item.status === "paid" ? "Liquidado" : "Cancelado"}</span></article>)}</div></section>}
      </>}
    </div>
  );
}
