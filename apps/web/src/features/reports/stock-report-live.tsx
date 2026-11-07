"use client"

import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LoadingState, ErrorState, EmptyState } from "@/components/workspace/resource-state"
import { Pagination } from "@/components/workspace/pagination"
import { downloadCsv } from "@/lib/csv-export"
import { stockExportRows } from "./report-model"
import { useStockReport } from "./use-report-data"

export function StockReportLive() {
  const [offset, setOffset] = useState(0)
  const { value: result, metrics, loading, error, status, reload } = useStockReport(offset)
  function exportCsv() { downloadCsv("relatorio-estoque.csv", stockExportRows(result?.data || [])) }

  return <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Estoque" title="Relatório de estoque" description="Saldos e reservas do inventário da empresa ativa." back={{ href: "/relatorios", label: "Relatórios" }} actions={<Button disabled={loading || Boolean(error) || !result?.data.length} variant="outline" onClick={exportCsv}><Download aria-hidden="true" />Exportar CSV</Button>} />
    {loading ? <LoadingState>Carregando saldos de estoque…</LoadingState> : error ? <ErrorState title="Não foi possível carregar o relatório" message={error} status={status} onRetry={reload} /> : !result?.data.length ? <EmptyState title="Nenhum saldo encontrado">Não há produtos nesta página de estoque para a empresa ativa.</EmptyState> : <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Produtos", String(metrics.products)], ["Saldo na página", metrics.quantity.toLocaleString("pt-BR")], ["Reservado na página", metrics.reserved.toLocaleString("pt-BR")], ["Sem disponibilidade", String(metrics.unavailable)]].map(([label, value]) => <div className="rounded-2xl border border-border bg-card p-5" key={label}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>)}</section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border p-4"><h2 className="font-semibold">Saldos consultados</h2><p className="mt-1 text-sm text-muted-foreground">Página {Math.floor((result.offset || 0) / (result.limit || 100)) + 1} de {Math.max(1, Math.ceil(result.total / (result.limit || 100)))}</p></div><div className="divide-y divide-border">{result.data.map((item) => <article className="grid gap-2 p-4 sm:grid-cols-[120px_minmax(0,1fr)_180px] sm:items-center" key={item.productId}><strong className="text-sm text-primary">{item.sku}</strong><div><h3 className="text-sm font-medium">{item.name}</h3><p className="text-sm text-muted-foreground">Saldo {item.quantity} {item.unit} · reservado {item.reserved} · disponível {item.available}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{item.status}</span></article>)}</div><div className="border-t border-border px-4"><Pagination offset={offset} pageSize={100} total={result.total} loading={loading} onOffsetChange={setOffset} /></div></section>
    </>}
  </div>;
}
