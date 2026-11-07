"use client"

import { useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { money, percent, type PriceTable } from "./negotiation-types"

export function CommercialTable() {
  const [line, setLine] = useState("imported")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const table = useResource<PriceTable>(`/api/erp/commercial/tables/${line}`)
  const items = (table.value?.data?.items || []).filter(item => `${item.name} ${item.sku}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")))
  const limit = 14
  return <main className="mx-auto min-w-0 max-w-6xl space-y-5 px-4 pb-24 pt-6">
    <PageHeader eyebrow="Vendas" title="Tabela de preços" description="Consulte a versão publicada e simule as condições antes de criar o pedido." />
    <div className="flex flex-wrap gap-3"><Link className="text-primary underline" href="/vendas/simulador">Simulador</Link>{table.value?.canManage && <><Link className="text-primary underline" href="/preferencias/tabela-precos">Editar custos e publicar</Link><Link className="text-primary underline" href="/preferencias/comercial">Preços e metas por destino</Link></>}</div>
    <div className="flex gap-2" aria-label="Linha comercial">{[["imported", "Importada"], ["national", "Nacional"]].map(([value, label]) => <Button key={value} variant={line === value ? "default" : "outline"} aria-pressed={line === value} onClick={() => { setLine(value); setOffset(0) }}>{label}</Button>)}</div>
    <label className="grid gap-2">Buscar equipamento por nome ou código<Input type="search" value={query} onChange={e => { setQuery(e.target.value); setOffset(0) }} /></label>
    {table.loading ? <p role="status">Carregando tabela…</p> : table.error ? <div role="alert"><RequestError message={table.error} status={table.status} /><Button variant="outline" onClick={table.reload}>Tentar novamente</Button></div> : !table.value?.data ? <section className="form-section space-y-3"><p>Nenhuma tabela publicada nesta linha.</p>{table.value?.canManage && <Link className="text-primary underline" href="/preferencias/tabela-precos">Preparar e publicar uma tabela</Link>}</section> : <>
      <p>Tabela v{table.value.data.version} · {new Date(table.value.data.publishedAt).toLocaleDateString("pt-BR")} · Preço em destaque com IPI</p>
      <div className="space-y-3">{items.slice(offset, offset + limit).map(item => <article key={item.productId} className="grid min-w-0 items-center gap-3 rounded-xl border p-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 space-y-2"><h2 className="break-words font-semibold">{item.name}</h2><p className="text-xs text-muted-foreground">{item.sku}</p><dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><div><dt>Sem IPI</dt><dd>{money(item.priceWithoutIpiCents)}</dd></div><div><dt>Com IPI</dt><dd className="font-semibold">{money(item.priceWithIpiCents)}</dd></div><div><dt>Desconto livre</dt><dd>{percent(table.value!.data!.freeDiscountBps)}</dd></div></dl></div><Link className="inline-flex min-h-10 items-center justify-center rounded-lg border px-4 text-primary" href={`/vendas/simulador?linha=${line}&produto=${item.productId}`}>Simular pedido</Link></article>)}</div>
      {!items.length && <p role="status">Nenhum equipamento corresponde à busca.</p>}
      <nav aria-label="Paginação da tabela" className="flex flex-wrap items-center justify-between gap-3"><span>{items.length ? `${offset + 1}–${Math.min(offset + limit, items.length)} de ${items.length}` : "0 equipamentos"}</span><div className="flex gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - limit))}>Anterior</Button><Button variant="outline" disabled={offset + limit >= items.length} onClick={() => setOffset(value => value + limit)}>Próxima</Button></div></nav>
    </>}
  </main>
}
