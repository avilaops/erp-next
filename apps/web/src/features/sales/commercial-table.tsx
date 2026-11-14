"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { DataTable, SortableTableHeader } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, EntityListPage, FilterField, ResponsiveTable, SearchToolbar } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useResource } from "@/hooks/use-operation"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { money, percent, type PriceTable } from "./negotiation-types"
import { CommercialTableDestinations } from "./commercial-table-destinations"
import { CommercialTableCart } from "./commercial-table-cart"
import { commercialSimulationHref, commercialTableHref, commercialTablePageSize, commercialTableRows, commercialTableSortFields, readCommercialTableQuery, type CommercialTableQuery } from "./commercial-navigation-model"

const authorityLabels = { seller: "Vendedor", managerTarget: "Gerência · limite na meta", managerProfit: "Gerência · limite sem prejuízo", director: "Diretoria" }
const unavailable = <span className="text-xs text-muted-foreground">Indisponível</span>
const amount = (value: number | null | undefined) => value == null ? unavailable : money(value)
const discount = (value: number | null | undefined) => value == null ? unavailable : percent(value)

export function CommercialTable() {
  const params = useSearchParams()
  const query = readCommercialTableQuery(params)
  const { line, offset } = query
  const q = String(query.q)
  const { sort, toggle } = useTableSort(commercialTableSortFields, { by: "", order: "asc" })
  const { by, order, explicit } = sort
  const [notice, setNotice] = useState("")
  function navigate(next: CommercialTableQuery, replace = false) {
    window.history[replace ? "replaceState" : "pushState"](null, "", commercialTableHref(next))
  }
  function select(productId: string, change: number) {
    const current = readCommercialTableQuery(new URLSearchParams(window.location.search))
    const selected = current.items.find(item => item.productId === productId)
    if (!selected && current.items.length >= 100) { setNotice("O pedido permite até 100 equipamentos diferentes."); return }
    const quantity = (selected?.quantity || 0) + change
    if (quantity > 1_000_000) { setNotice("A quantidade máxima por equipamento é 1.000.000."); return }
    const next = selected ? current.items.flatMap(item => item.productId === productId ? quantity > 0 ? [{ ...item, quantity }] : [] : [item]) : [...current.items, { productId, quantity }]
    navigate({ ...current, items: next }, true)
    const name = table.value?.data?.items.find(item => item.productId === productId)?.name || "Equipamento"
    setNotice(quantity > 0 ? `${name}: ${quantity} un. na seleção do pedido.` : `${name} removido da seleção.`)
  }
  const apiParams = new URLSearchParams()
  if (query.destinationState) apiParams.set("destinationState", query.destinationState)
  if (query.taxpayer) apiParams.set("taxpayer", "true")
  const table = useResource<PriceTable>(`/api/erp/commercial/tables/${line}${apiParams.size ? `?${apiParams}` : ""}`)
  const data = table.value?.data
  const destination = query.destinationState || data?.context?.destinationState || data?.originState || ""
  const items = useMemo(() => commercialTableRows(data?.items || [], { q, sortBy: explicit ? by : undefined, sortOrder: order }), [data?.items, q, by, order, explicit])
  const limit = commercialTablePageSize
  const units = query.items.reduce((total, item) => total + item.quantity, 0)
  const cartAvailable = !!table.value?.canCreateOrder && !!data && query.items.every(selected => data.items.some(item => item.productId === selected.productId && item.available === true))
  const freeLabel = data ? `Com ${percent(data.freeDiscountBps)} desc. + IPI` : "Com desconto livre + IPI"

  return <main className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 pb-28 pt-3 sm:px-4 sm:pt-6 [--workspace-control-height:2.25rem]">
    <EntityListPage title="Tabela de preços" description="Compare os preços publicados e sua alçada por destino. Selecione os equipamentos para abrir a negociação." actions={<nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Navegação comercial">
      <Link className="text-primary underline" href={commercialSimulationHref(query)}>Simulador</Link>
      <Link className="text-primary underline" href="/vendas/pedidos">Pedidos</Link>
      {table.value?.canManage && <><Link className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href={`/preferencias/tabela-precos?linha=${line}`}>Nova tabela de preços</Link><Link className="text-primary underline" href={`/preferencias/comercial?linha=${line}`}>Preços e metas por destino</Link></>}
    </nav>} toolbar={<SearchToolbar onSubmit={event => { event.preventDefault(); navigate({ ...query, q: String(new FormData(event.currentTarget).get("q") || "").trim().slice(0, 160), offset: 0 }) }} onClear={() => navigate({ ...query, q: "", offset: 0 })} canClear={!!q}>
      <div className="flex gap-2" aria-label="Linha comercial">{([["imported", "Importada"], ["national", "Nacional"]] as const).map(([value, label]) => <Button type="button" className="h-9" key={value} variant={line === value ? "default" : "outline"} aria-pressed={line === value} onClick={() => navigate({ ...query, line: value, offset: 0 })}>{label}</Button>)}</div>
      <FilterField label="Destino (UF)"><select aria-label="Destino (UF)" className="h-9 rounded-lg border bg-background px-2 text-sm" value={destination} onChange={event => navigate({ ...query, destinationState: event.target.value, offset: 0 })}>{!destination && <option value="">Selecione</option>}{states.map(state => <option key={state} value={state}>{state}</option>)}</select></FilterField>
      <div className="flex gap-1" role="group" aria-label="Inscrição estadual">{([[false, "Sem IE"], [true, "Com IE"]] as const).map(([value, label]) => <Button type="button" className="h-9" key={label} variant={query.taxpayer === value ? "default" : "outline"} aria-pressed={query.taxpayer === value} onClick={() => navigate({ ...query, destinationState: destination, taxpayer: value, offset: 0 })}>{label}</Button>)}</div>
      <FilterField label="Buscar equipamento por nome ou código" className="min-w-0 flex-1 basis-64"><SearchInput name="q" className="h-9" type="search" defaultValue={q} onSearch={q => navigate({ ...query, q: q.trim().slice(0, 160), offset: 0 })} /></FilterField>
    </SearchToolbar>}>
    <p role="status" aria-live="polite" className={notice ? "text-xs text-muted-foreground" : "sr-only"}>{notice}</p>
    {units > 0 && <CommercialTableCart query={query} data={data || null} canOpen={cartAvailable && !table.loading && !table.error} onChange={select} onClear={() => { navigate({ ...query, items: [] }, true); setNotice("Seleção do pedido esvaziada.") }} />}
    {table.loading ? <p role="status">Carregando tabela…</p> : table.error ? <div role="alert"><RequestError message={table.error} status={table.status} /><Button variant="outline" onClick={table.reload}>Tentar novamente</Button></div> : !data ? <EmptyState filtered={false} title="Nenhuma tabela publicada nesta linha." action={table.value?.canManage && <Link className="text-primary underline" href={`/preferencias/tabela-precos?linha=${line}`}>Criar tabela de preços</Link>} /> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><p>Tabela v{data.version} · {new Date(data.publishedAt).toLocaleDateString("pt-BR")} · {data.items.length} equipamentos</p>{table.value?.authority && <p>Seu acesso: <strong className="font-medium text-foreground">{authorityLabels[table.value.authority]}</strong></p>}</div>
      {table.value?.canCreateOrder === false && <p className="text-xs text-muted-foreground">Seu acesso permite consultar e simular. Criar pedidos exige permissão de gestão de vendas.</p>}
      {data.availability?.message && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{data.availability.message}</p>}
      <CommercialTableDestinations data={data} destination={destination} taxpayer={query.taxpayer} onSelect={destinationState => navigate({ ...query, destinationState, offset: 0 })} />
      <p className="text-xs text-muted-foreground">Valores por unidade · sem frete por nossa conta · entrada conforme a política. Com IE: cliente contribuinte do ICMS.</p>
      <ResponsiveTable label="Preços publicados" className="rounded-lg border">
        <DataTable aria-label="Preços publicados" className="min-w-[70rem] text-xs [&_td]:px-3 [&_td]:py-3 [&_th]:px-3">
          <thead><tr><SortableTableHeader field="name" sort={sort} onSort={toggle} className="min-w-[18rem]">Equipamento</SortableTableHeader><SortableTableHeader field="priceWithoutIpiCents" sort={sort} onSort={toggle} className="min-w-36 text-right">Sem IPI</SortableTableHeader><SortableTableHeader field="priceWithIpiCents" sort={sort} onSort={toggle} className="min-w-36 text-right">Com IPI</SortableTableHeader><SortableTableHeader field="freeDiscountPriceWithIpiCents" sort={sort} onSort={toggle} className="min-w-40 text-right">{freeLabel}</SortableTableHeader><SortableTableHeader field="maxOwnDiscountBps" sort={sort} onSort={toggle} className="min-w-32 text-right">Máx. sua alçada</SortableTableHeader><SortableTableHeader field="minOwnPriceWithIpiCents" sort={sort} onSort={toggle} className="min-w-40 text-right">Menor preço c/IPI</SortableTableHeader><th scope="col" className="min-w-36"><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{items.slice(offset, offset + limit).map(item => {
            const canAdd = !!table.value?.canCreateOrder && item.available === true
            const selected = query.items.find(selected => selected.productId === item.productId)?.quantity || 0
            const reason = item.unavailableReason || (!table.value?.canCreateOrder ? "Seu acesso permite consultar e simular." : "Equipamento indisponível para negociar.")
            const actions = <><Button className="h-9 px-3 text-xs" variant="outline" disabled={!canAdd} title={canAdd ? `Adicionar ${item.name} ao pedido` : reason} onClick={() => select(item.productId, 1)}>+ Pedido</Button><Link className="inline-flex min-h-9 items-center text-xs text-primary underline underline-offset-4" href={commercialSimulationHref(query, item.productId)}>Simular pedido</Link></>
            return <tr key={item.productId}>
              <th scope="row" className="min-w-[18rem] max-w-[24rem] break-words text-left font-normal align-top"><Link className="font-medium text-primary underline underline-offset-4" href={`/cadastros/produtos/${item.productId}`}>{item.name}</Link><div className="mt-1 text-xs font-normal text-muted-foreground">SKU {item.sku} · {item.unit}{selected > 0 && <span className="block font-medium text-foreground">{selected} un. selecionadas</span>}</div>{item.unavailableReason && <p className="mt-2 text-xs text-muted-foreground">{item.unavailableReason}</p>}</th>
              <CurrencyCell>{money(item.priceWithoutIpiCents)}</CurrencyCell>
              <CurrencyCell className="align-top"><span className="font-semibold">{money(item.priceWithIpiCents)}</span><span className="block text-[11px] text-muted-foreground">IPI {percent(item.ipiBps)}</span></CurrencyCell>
              <CurrencyCell>{amount(item.freeDiscountPriceWithIpiCents)}</CurrencyCell>
              <CurrencyCell>{discount(item.maxOwnDiscountBps)}</CurrencyCell>
              <CurrencyCell className="font-medium">{amount(item.minOwnPriceWithIpiCents)}</CurrencyCell>
              <td><div className="flex flex-col items-start gap-1">{actions}</div></td>
            </tr>
          })}</tbody>
        </DataTable>
      </ResponsiveTable>
      {!items.length && <EmptyState filtered={!!q} title="Nenhum equipamento corresponde à busca." />}
      <nav aria-label="Paginação da tabela" className="flex flex-wrap items-center justify-between gap-3 text-xs"><span>{items.length ? `${offset + 1} a ${Math.min(offset + limit, items.length)} de ${items.length}` : "0 equipamentos"}</span><div className="flex gap-2"><Button className="h-9" variant="outline" disabled={offset === 0} onClick={() => navigate({ ...query, offset: Math.max(0, offset - limit) })}>Anterior</Button><Button className="h-9" variant="outline" disabled={offset + limit >= items.length} onClick={() => navigate({ ...query, offset: offset + limit })}>Próxima</Button></div></nav>
    </>}
    </EntityListPage>
  </main>
}
