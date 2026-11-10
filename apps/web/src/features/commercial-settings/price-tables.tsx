"use client"

import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/workspace/data-table"
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
    <PageHeader eyebrow="Vendas / Tabelas de preços" title="Nova tabela de preços" description="Escolha a linha, confira os preços calculados e publique uma nova versão." />
    <div className="flex flex-wrap gap-3"><Link href="/vendas/simulador" className="text-primary underline">Simular negociação</Link><Link href="/preferencias/comercial" className="text-primary underline">Parâmetros comerciais</Link><Link href="/preferencias/despesas-fixas" className="text-primary underline">Despesas fixas</Link></div>
    <label className="grid max-w-xs gap-1">Linha comercial<select disabled={locked} className="min-h-10 rounded-lg border bg-background px-2" value={line} onChange={e => setLine(e.target.value as typeof line)}><option value="imported">Importada</option><option value="national">Nacional</option></select></label>
    <Publication key={line} line={line} onLocked={setLocked} />
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
    {preview && <section className="form-section min-w-0 space-y-2"><h2 className="font-semibold">Conferência antes de publicar</h2><p>{preview.items.length} produtos · revisão {preview.revision}</p><Prices items={preview.items} /><Button disabled={command.busy || command.stale} onClick={publish}>{command.uncertain ? "Repetir confirmação" : "Confirmar publicação"}</Button></section>}
    {notice && <p role="status">{notice}</p>}{(error || command.error) && <p role="alert">{error || command.error}</p>}
    {command.stale && <p>Os dados mudaram. Prepare nova prévia e confira os valores.</p>}
    <section className="form-section min-w-0 space-y-2"><h2 className="font-semibold">Versão publicada</h2>{current.loading ? <p role="status">Carregando…</p> : current.error ? <p role="alert"><RequestError message={current.error} status={current.status} /></p> : current.value?.data ? <><p>Versão {current.value.data.version} · {new Date(current.value.data.publishedAt).toLocaleString("pt-BR")}</p><Prices items={current.value.data.items} /></> : <p>Nenhuma versão publicada nesta linha.</p>}</section>
  </div>
}

function Prices({ items }: { items: Item[] }) {
  return <div className="min-w-0 rounded-lg border"><DataTable aria-label="Produtos da tabela de preços" className="table-fixed [&_td]:px-2 [&_th]:px-2"><thead><tr><th scope="col" className="w-[54%] lg:w-[40%]">Equipamento</th><th scope="col" className="hidden text-right lg:table-cell lg:w-[22%]">Sem IPI</th><th scope="col" className="hidden text-right lg:table-cell lg:w-[10%]">IPI</th><th scope="col" className="w-[46%] text-right lg:w-[28%]">Com IPI</th></tr></thead><tbody>{items.map(item => <tr key={item.productId}>
    <th scope="row" className="text-left align-top font-normal [overflow-wrap:anywhere]"><span className="font-medium">{item.name}</span><p className="mt-1 text-xs text-muted-foreground">{item.sku}</p><p className="mt-1 text-xs text-muted-foreground lg:hidden">IPI <span>{(item.ipiBps / 100).toLocaleString("pt-BR")}%</span></p></th>
    <td className="hidden text-right tabular-nums [overflow-wrap:anywhere] lg:table-cell">{money(item.priceWithoutIpiCents)}</td><td className="hidden text-right lg:table-cell">{(item.ipiBps / 100).toLocaleString("pt-BR")}%</td>
    <td className="text-right align-top tabular-nums [overflow-wrap:anywhere]"><span className="font-semibold">{money(item.priceWithIpiCents)}</span><dl className="mt-2 text-xs lg:hidden"><dt className="text-muted-foreground">Sem IPI</dt><dd>{money(item.priceWithoutIpiCents)}</dd></dl></td>
  </tr>)}</tbody></DataTable></div>
}

