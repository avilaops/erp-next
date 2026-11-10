"use client"

import { useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/workspace/data-table"
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
  return <main className="mx-auto min-w-0 max-w-6xl space-y-5 pb-24 pt-3 sm:px-4 sm:pt-6 [--workspace-control-height:2.25rem]">
    <PageHeader eyebrow="Vendas" title="Tabela de preços" description="Consulte a versão publicada e simule as condições antes de criar o pedido." />
    <div className="flex flex-wrap gap-3"><Link className="text-primary underline" href="/vendas/simulador">Simulador</Link>{table.value?.canManage && <><Link className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href={`/preferencias/tabela-precos?linha=${line}`}>Nova tabela de preços</Link><Link className="text-primary underline" href="/preferencias/comercial">Preços e metas por destino</Link></>}</div>
    <div className="flex gap-2" aria-label="Linha comercial">{[["imported", "Importada"], ["national", "Nacional"]].map(([value, label]) => <Button key={value} variant={line === value ? "default" : "outline"} aria-pressed={line === value} onClick={() => { setLine(value); setOffset(0) }}>{label}</Button>)}</div>
    <label className="grid gap-2">Buscar equipamento por nome ou código<Input type="search" value={query} onChange={e => { setQuery(e.target.value); setOffset(0) }} /></label>
    {table.loading ? <p role="status">Carregando tabela…</p> : table.error ? <div role="alert"><RequestError message={table.error} status={table.status} /><Button variant="outline" onClick={table.reload}>Tentar novamente</Button></div> : !table.value?.data ? <section className="form-section space-y-3"><p>Nenhuma tabela publicada nesta linha.</p>{table.value?.canManage && <Link className="text-primary underline" href={`/preferencias/tabela-precos?linha=${line}`}>Criar tabela de preços</Link>}</section> : <>
      <p>Tabela v{table.value.data.version} · {new Date(table.value.data.publishedAt).toLocaleDateString("pt-BR")} · Preço em destaque com IPI</p>
      <div className="min-w-0 rounded-lg border">
        <DataTable aria-label="Preços publicados" className="table-fixed [&_td]:px-2 [&_th]:px-2 lg:[&_td]:px-4 lg:[&_th]:px-4">
          <thead><tr><th scope="col" className="w-[54%] lg:w-[34%]">Equipamento</th><th scope="col" className="hidden text-right lg:table-cell lg:w-[17%]">Sem IPI</th><th scope="col" className="w-[46%] text-right lg:w-[17%]">Com IPI</th><th scope="col" className="hidden text-right lg:table-cell lg:w-[15%]">Desconto livre</th><th scope="col" className="hidden lg:table-cell lg:w-[17%]"><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{items.slice(offset, offset + limit).map(item => <tr key={item.productId}>
            <th scope="row" className="text-left font-normal align-top [overflow-wrap:anywhere]"><Link className="font-medium text-primary underline underline-offset-4" href={`/cadastros/produtos/${item.productId}`}>{item.name}</Link><div className="mt-1 text-xs font-normal text-muted-foreground">SKU {item.sku} · {item.unit}</div><Link className="mt-2 inline-flex min-h-9 items-center text-sm font-medium text-primary underline underline-offset-4 lg:hidden" href={`/vendas/simulador?linha=${line}&produto=${item.productId}`}>Simular pedido</Link></th>
            <td className="hidden text-right tabular-nums [overflow-wrap:anywhere] lg:table-cell">{money(item.priceWithoutIpiCents)}</td>
            <td className="text-right align-top tabular-nums [overflow-wrap:anywhere]">
              <span className="font-semibold">{money(item.priceWithIpiCents)}</span><span className="block text-xs text-muted-foreground lg:hidden">Com IPI</span>
              <dl className="mt-2 space-y-2 text-xs lg:hidden"><div><dt className="text-muted-foreground">Sem IPI</dt><dd>{money(item.priceWithoutIpiCents)}</dd></div><div><dt className="text-muted-foreground">Desconto livre</dt><dd>{percent(table.value!.data!.freeDiscountBps)}</dd></div></dl>
            </td>
            <td className="hidden text-right tabular-nums lg:table-cell">{percent(table.value!.data!.freeDiscountBps)}</td>
            <td className="hidden [overflow-wrap:anywhere] lg:table-cell"><Link className="inline-flex min-h-9 items-center text-primary underline underline-offset-4" href={`/vendas/simulador?linha=${line}&produto=${item.productId}`}>Simular pedido</Link></td>
          </tr>)}</tbody>
        </DataTable>
      </div>
      {!items.length && <p role="status">Nenhum equipamento corresponde à busca.</p>}
      <nav aria-label="Paginação da tabela" className="flex flex-wrap items-center justify-between gap-3"><span>{items.length ? `${offset + 1} a ${Math.min(offset + limit, items.length)} de ${items.length}` : "0 equipamentos"}</span><div className="flex gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - limit))}>Anterior</Button><Button variant="outline" disabled={offset + limit >= items.length} onClick={() => setOffset(value => value + limit)}>Próxima</Button></div></nav>
    </>}
  </main>
}
