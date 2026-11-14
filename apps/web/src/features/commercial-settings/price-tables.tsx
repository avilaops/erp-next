"use client"

import { useMemo, useState } from "react"
import { DataTable, SortableTableHeader } from "@/components/workspace/data-table"
import { CurrencyCell, EntityListPage, FilterField, ResponsiveTable } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { sortTableRows } from "@/components/workspace/table-sort-model"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { useNavigationGuard } from "@/components/shell/navigation-guard"

type Item = { productId: string; sku: string; name: string; priceWithoutIpiCents: number; ipiBps: number; priceWithIpiCents: number }
type Preview = { tenantId: string; line: string; revision: number; digest: string; items: Item[] }
type Current = { tenantId: string; line: string; data: { version: number; publishedAt: string; items: Item[] } | null }
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export function PriceTables({ initialLine = "imported" }: { initialLine?: "imported" | "national" }) {
  const [line, setLine] = useState<"imported" | "national">(initialLine)
  const [locked, setLocked] = useState(false)
  return <main className="mx-auto min-w-0 max-w-5xl space-y-3 px-4 pb-12 pt-4 [--workspace-control-height:2.25rem]">
    <EntityListPage title="Nova tabela de preços" description="Escolha a linha, confira os preços calculados e publique uma nova versão." actions={<div className="flex flex-wrap gap-3"><Link href="/vendas/simulador" className="text-primary underline">Simular negociação</Link><Link href="/preferencias/comercial" className="text-primary underline">Parâmetros comerciais</Link><Link href="/preferencias/despesas-fixas" className="text-primary underline">Despesas fixas</Link></div>}>
    <FilterField label="Linha comercial" className="max-w-xs"><select disabled={locked} className="min-h-10 rounded-lg border bg-background px-2" value={line} onChange={e => setLine(e.target.value as typeof line)}><option value="imported">Importada</option><option value="national">Nacional</option></select></FilterField>
    <Publication key={line} line={line} onLocked={setLocked} />
    </EntityListPage>
  </main>
}

function Publication({ line, onLocked }: { line: "imported" | "national"; onLocked: (value: boolean) => void }) {
  const current = useResource<Current>(`/api/erp/price-tables/${line}`)
  const command = useCommand()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  useNavigationGuard(command.busy || command.uncertain ? "A publicação ainda não foi confirmada. Sair?" : null)
  async function prepare() {
    if (!current.value || preparing || command.busy || command.uncertain) return
    onLocked(true); setPreparing(true); setPreview(null); setError(""); setNotice(""); command.reset()
    try {
      const response = await fetch(`/api/erp/price-tables/${line}/preview`, { cache: "no-store" })
      const result = await response.json()
      if (!response.ok) throw Error(result.title || "Não foi possível preparar a tabela.")
      if (result.tenantId !== current.value.tenantId || result.line !== line || response.headers.get("etag") !== `"${result.revision}"` || !/^[a-f0-9]{64}$/.test(result.digest) || !Array.isArray(result.items) || !result.items.length) throw Error("Prévia incompleta. Recarregue antes de publicar.")
      setPreview(result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Prévia indisponível.") }
    finally { setPreparing(false); onLocked(false) }
  }
  async function publish() {
    if (!preview || !current.value || command.busy) return
    onLocked(true)
    const result = await command.send<{ tenantId: string; line: string; status: string; version: number }>(`/api/erp/price-tables/${line}/publish`, current.value.tenantId, { digest: preview.digest }, `"${preview.revision}"`)
    if (result?.tenantId === current.value.tenantId && result.line === line && result.status === "published") {
      setNotice(`Versão ${result.version} publicada.`); setPreview(null); current.reload(); onLocked(false)
    } else if (result) { setError("Resposta divergente. Confira a versão publicada."); onLocked(false) }
  }
  return <div className="min-w-0 space-y-3">
    <p>Publicar cria uma versão da tabela com os custos dos produtos ativos e os parâmetros salvos. Produtos e pedidos existentes mantêm os preços cadastrados.</p>
    <Button variant="outline" disabled={!current.value || preparing || command.busy || command.uncertain} onClick={prepare}>{preparing ? "Preparando…" : "Preparar prévia"}</Button>
    {preview && <section className="form-section min-w-0 space-y-2"><h2 className="font-semibold">Conferência antes de publicar</h2><p>{preview.items.length} produtos · revisão {preview.revision}</p><Prices items={preview.items} prefix="preview" label="Preços da prévia" /><Button disabled={command.busy || command.stale} onClick={publish}>{command.uncertain ? "Repetir confirmação" : "Confirmar publicação"}</Button></section>}
    {notice && <p role="status">{notice}</p>}{(error || command.error) && <p role="alert">{error || command.error}</p>}
    {command.stale && <p>Os dados mudaram. Prepare nova prévia e confira os valores.</p>}
    <section className="form-section min-w-0 space-y-2"><h2 className="font-semibold">Versão publicada</h2>{current.loading ? <p role="status">Carregando…</p> : current.error ? <p role="alert"><RequestError message={current.error} status={current.status} /></p> : current.value?.data ? <><p>Versão {current.value.data.version} · {new Date(current.value.data.publishedAt).toLocaleString("pt-BR")}</p><Prices items={current.value.data.items} prefix="published" label="Preços da versão publicada" /></> : <p>Nenhuma versão publicada nesta linha.</p>}</section>
  </div>
}

const priceSortFields = ["name", "priceWithoutIpiCents", "ipiBps", "priceWithIpiCents"] as const
const priceAccessors = { name: (item: Item) => item.name, priceWithoutIpiCents: (item: Item) => item.priceWithoutIpiCents, ipiBps: (item: Item) => item.ipiBps, priceWithIpiCents: (item: Item) => item.priceWithIpiCents }
function Prices({ items, prefix, label }: { items: Item[]; prefix: string; label: string }) {
  const { sort, toggle } = useTableSort(priceSortFields, { by: "", order: "asc" }, prefix)
  const { by, order, explicit } = sort
  const rows = useMemo(() => explicit ? sortTableRows(items, { by, order, explicit }, priceAccessors, item => item.productId) : items, [items, by, order, explicit])
  return <ResponsiveTable label={label} className="rounded-lg border"><DataTable aria-label="Produtos da tabela de preços" className="min-w-[48rem] [&_td]:px-3 [&_th]:px-3"><thead><tr><SortableTableHeader field="name" sort={sort} onSort={toggle} className="min-w-[18rem]">Equipamento</SortableTableHeader><SortableTableHeader field="priceWithoutIpiCents" sort={sort} onSort={toggle} className="min-w-40 text-right">Sem IPI</SortableTableHeader><SortableTableHeader field="ipiBps" sort={sort} onSort={toggle} className="min-w-24 text-right">IPI</SortableTableHeader><SortableTableHeader field="priceWithIpiCents" sort={sort} onSort={toggle} className="min-w-40 text-right">Com IPI</SortableTableHeader></tr></thead><tbody>{rows.map(item => <tr key={item.productId}>
    <th scope="row" className="min-w-[18rem] max-w-[26rem] break-words text-left align-top font-normal"><span className="font-medium">{item.name}</span><p className="mt-1 text-xs text-muted-foreground">{item.sku}</p></th>
    <CurrencyCell>{money(item.priceWithoutIpiCents)}</CurrencyCell><td className="whitespace-nowrap text-right tabular-nums">{(item.ipiBps / 100).toLocaleString("pt-BR")}%</td>
    <CurrencyCell className="font-semibold">{money(item.priceWithIpiCents)}</CurrencyCell>
  </tr>)}</tbody></DataTable></ResponsiveTable>
}

