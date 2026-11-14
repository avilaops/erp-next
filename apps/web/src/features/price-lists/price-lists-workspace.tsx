"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { DataTable, SortableTableHeader } from "@/components/workspace/data-table"
import { CurrencyCell, EmptyState, EntityListPage, FilterField, ResponsiveTable, SearchToolbar, StatusBadge } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { sortTableRows } from "@/components/workspace/table-sort-model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GuardedLink, useNavigationGuard } from "@/components/shell/navigation-guard"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"
import { normalizeDecimal } from "@/lib/decimal-input"
import { Lookup, type Choice } from "@/features/sales/orders"
import { commercialMoney } from "@/features/sales/order-presentation"

type Row = { id: string; revision: number; code: string; name: string; status: "active" | "archived"; validFrom: string | null; validUntil: string | null; itemCount: number }
type Item = { productId: string; name: string; sku: string; unit: string; price: string }
type Snapshot = { tenantId: string; canEdit: boolean; data: Row & { notes: string | null; items: Item[] } }
type Listing = { tenantId: string; canEdit: boolean; data: Row[]; total: number; offset: number; limit: number }
type Props = { tenantId: string; id?: string; create?: boolean; edit?: boolean }
const base = "/cadastros/listas-precos"
const trail = [{ label: "Cadastros", href: "/cadastros" }, { label: "Listas de preços", href: base }]
const link = "font-medium text-primary underline underline-offset-4"
const cell = "p-3 text-left"
const listSortFields = ["code", "name", "status", "validFrom", "validUntil", "itemCount"] as const
function date(value: string | null) { return value ? value.split("-").reverse().join("/") : "Não informado" }

export function PriceListsWorkspace(props: Props) {
  return <div className="min-w-0 text-sm">{props.create || props.id ? <PriceListRecord {...props} /> : <PriceListListing tenantId={props.tenantId} />}</div>
}
function PriceListListing({ tenantId }: { tenantId: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const { sort, toggle, query } = useTableSort(listSortFields, { by: "name", order: "asc" })
  const q = (params.get("q") || "").slice(0, 160)
  const status = ["active", "archived"].includes(params.get("status") || "") ? params.get("status")! : ""
  const rawOffset = params.get("offset") || "0"
  const offset = /^\d{1,6}$/.test(rawOffset) && Number(rawOffset) <= 100000 ? Number(rawOffset) : 0
  const rawLimit = params.get("limit") || "25"
  const limit = /^\d{1,3}$/.test(rawLimit) && Number(rawLimit) >= 1 && Number(rawLimit) <= 100 ? Number(rawLimit) : 25
  const apiParams = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (q) apiParams.set("q", q)
  if (status) apiParams.set("status", status)
  query.forEach((value, key) => apiParams.set(key, value))
  const result = useResource<Listing>(`/api/erp/price-lists?${apiParams}`)
  const value = result.value
  const sameTenant = value?.tenantId === tenantId
  const returnTo = `${base}${params.size ? `?${params}` : ""}`
  function navigate(next: { q?: string; status?: string; offset?: number }) {
    const updated = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) { if (value) updated.set(key, String(value)); else updated.delete(key) }
    router.push(`${base}${updated.size ? `?${updated}` : ""}`, { scroll: false })
  }
  return <EntityListPage title="Listas de preços" description="Consulte os preços definidos por lista e sua vigência." actions={sameTenant && value.canEdit && <GuardedLink className={link} href={recordHref("novo", returnTo)}>Nova lista</GuardedLink>} toolbar={<SearchToolbar key={`${q}:${status}`} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate({ q: String(data.get("q") || "").trim(), status: String(data.get("status") || ""), offset: 0 }) }} onClear={() => navigate({ q: "", status: "", offset: 0 })} canClear={!!q || !!status}>
      <FilterField label="Buscar lista" className="flex-1"><Input name="q" maxLength={160} defaultValue={q} /></FilterField><FilterField label="Situação"><select name="status" className="min-h-10 rounded-lg border px-3" defaultValue={status}><option value="">Todas</option><option value="active">Ativa</option><option value="archived">Arquivada</option></select></FilterField>
    </SearchToolbar>}>
    {result.loading ? <p role="status">Carregando listas…</p> : result.error ? <Failure error={result.error} status={result.status} reload={result.reload} /> : !sameTenant ? <p role="alert">Não foi possível confirmar a empresa desta consulta.</p> : <>
      <p className="text-xs text-muted-foreground">{value.total} lista(s)</p>
      <ResponsiveTable label="Listas de preços"><DataTable className="min-w-[48rem]"><caption className="sr-only">Listas de preços</caption><thead><tr>{[["code", "Código"], ["name", "Nome"], ["status", "Situação"], ["validFrom", "Início da vigência"], ["validUntil", "Fim da vigência"], ["itemCount", "Produtos"]].map(([field, label]) => <SortableTableHeader className={field === "itemCount" ? "p-3 text-right" : cell} key={field} field={field} sort={sort} onSort={toggle}>{label}</SortableTableHeader>)}</tr></thead><tbody>{value.data.map(row => <tr key={row.id} className="border-t"><td className={cell}>{row.code}</td><td className={`${cell} min-w-56`}><GuardedLink className={link} href={recordHref(row.id, returnTo)}>{row.name}</GuardedLink></td><td className={cell}><StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Ativa" : "Arquivada"}</StatusBadge></td><td className={`${cell} whitespace-nowrap`}>{date(row.validFrom)}</td><td className={`${cell} whitespace-nowrap`}>{date(row.validUntil)}</td><td className="p-3 text-right tabular-nums">{row.itemCount}</td></tr>)}</tbody></DataTable></ResponsiveTable>
      {!value.data.length && <EmptyState filtered={!!q || !!status} action={!q && !status && value.canEdit && <GuardedLink className={link} href={recordHref("novo", returnTo)}>Nova lista</GuardedLink>} />}<nav aria-label="Paginação das listas de preços" className="flex justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => navigate({ offset: Math.max(0, offset - limit) })}>Anterior</Button><Button variant="outline" disabled={offset + limit >= value.total} onClick={() => navigate({ offset: offset + limit })}>Próxima</Button></nav>
    </>}
  </EntityListPage>
}
function listingReturn(value: string | null) {
  if (!value) return base
  try { const url = new URL(value, "https://erp.local"); return url.origin === "https://erp.local" && url.pathname === base ? `${base}${url.search}` : base } catch { return base }
}
function recordHref(id: string, returnTo: string, edit = false) { return `${base}/${id}${edit ? "/editar" : ""}${returnTo === base ? "" : `?${new URLSearchParams({ returnTo })}`}` }
function Failure({ error, status, reload }: { error: string; status: number; reload: () => void }) { return <div className="space-y-3"><div role="alert"><RequestError message={error} status={status} /></div><Button variant="outline" onClick={reload}>Tentar novamente</Button></div> }
function PriceListRecord({ tenantId, id, create, edit }: Props) {
  const params = useSearchParams()
  const returnTo = listingReturn(params.get("returnTo"))
  const result = useResource<Snapshot | Listing>(create ? "/api/erp/price-lists?limit=1" : `/api/erp/price-lists/${id}`)
  const title = create ? "Nova lista de preços" : edit ? "Editar lista de preços" : "Lista de preços"
  if (result.loading || result.error || !result.value || result.value.tenantId !== tenantId) return <><PageHeader title={title} breadcrumbs={[...trail, { label: create ? "Nova lista" : edit ? "Editar" : "Detalhes" }]} />{result.loading ? <p role="status">Carregando lista…</p> : <Failure error={result.error || "Não foi possível confirmar a empresa desta consulta."} status={result.status} reload={result.reload} />}</>
  const initial = Array.isArray(result.value.data) ? undefined : result.value as Snapshot
  if (create || edit) return result.value.canEdit ? <PriceListForm key={`${id || "new"}:${result.etag}`} tenantId={tenantId} initial={initial} etag={result.etag} reload={result.reload} returnTo={returnTo} /> : <><PageHeader title={title} breadcrumbs={[...trail, { label: "Acesso" }]} /><p>Você pode consultar as listas, mas não tem permissão para alterá-las.</p><GuardedLink className={link} href={id ? recordHref(id, returnTo) : returnTo}>Voltar</GuardedLink></>
  if (!initial) return <Failure error="Lista indisponível." status={0} reload={result.reload} />
  const { data } = initial
  return <><PageHeader title={data.name} breadcrumbs={[...trail, { label: data.name }]} back={{ href: returnTo, label: "Voltar às listas" }} actions={initial.canEdit && <GuardedLink className={link} href={recordHref(id!, returnTo, true)}>Editar lista</GuardedLink>} description="Os preços desta lista não alteram o preço base do catálogo." /><section className="form-section min-w-0 space-y-5"><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Código</dt><dd>{data.code}</dd></div><div><dt className="text-xs text-muted-foreground">Situação</dt><dd><StatusBadge tone={data.status === "active" ? "success" : "neutral"}>{data.status === "active" ? "Ativa" : "Arquivada"}</StatusBadge></dd></div><div><dt className="text-xs text-muted-foreground">Início da vigência</dt><dd>{date(data.validFrom)}</dd></div><div><dt className="text-xs text-muted-foreground">Fim da vigência</dt><dd>{date(data.validUntil)}</dd></div></dl><PriceListItems items={data.items} />{data.notes && <section><h2 className="text-lg font-medium">Observações</h2><p className="whitespace-pre-wrap break-words">{data.notes}</p></section>}</section></>
}
const itemSortFields = ["name", "sku", "unit", "price"] as const
const itemAccessors = { name: (item: Item) => item.name, sku: (item: Item) => item.sku, unit: (item: Item) => item.unit, price: (item: Item) => { const [integer, fraction = ""] = item.price.split("."); return BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, "0")) } }
function PriceListItems({ items }: { items: Item[] }) {
  const { sort, toggle } = useTableSort(itemSortFields, { by: "name", order: "asc" }, "items")
  const { by, order, explicit } = sort
  const rows = useMemo(() => explicit ? sortTableRows(items, { by, order, explicit }, itemAccessors, item => item.productId) : items, [items, by, order, explicit])
  return <ResponsiveTable label="Produtos da lista"><DataTable className="min-w-[42rem]"><caption className="sr-only">Produtos da lista</caption><thead><tr>{[["name", "Produto"], ["sku", "Código"], ["unit", "Unidade"], ["price", "Preço"]].map(([field, label]) => <SortableTableHeader key={field} field={field} sort={sort} onSort={toggle} className={field === "price" ? "p-3 text-right" : cell}>{label}</SortableTableHeader>)}</tr></thead><tbody>{rows.map(item => <tr key={item.productId} className="border-t"><td className={`${cell} min-w-[18rem] max-w-[28rem] break-words`}>{item.name}</td><td className={cell}>{item.sku}</td><td className={cell}>{item.unit}</td><CurrencyCell className="p-3">{commercialMoney(item.price)}</CurrencyCell></tr>)}</tbody></DataTable></ResponsiveTable>
}
function PriceListForm({ tenantId, initial, etag, reload, returnTo }: { tenantId: string; initial?: Snapshot; etag: string; reload: () => void; returnTo: string }) {
  const router = useRouter()
  const command = useCommand()
  const [items, setItems] = useState<Item[]>(initial?.data.items.map(item => ({ ...item, price: item.price.replace(".", ",") })) || [])
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  useNavigationGuard(dirty || command.uncertain ? "Sair sem confirmar as alterações desta lista?" : null)
  function choose(product: Choice) {
    if (items.some(item => item.productId === product.id)) { setError("Produto já incluído. Altere o preço na lista."); return }
    if (items.length >= 1000) { setError("A lista permite até 1.000 produtos."); return }
    setItems(old => [...old, { productId: product.id, name: product.name || product.sku || "Produto", sku: product.sku || "", unit: product.unit || "", price: (product.basePrice || "").replace(".", ",") }]); setDirty(true); setError("")
  }
  return <><PageHeader title={initial ? "Editar lista de preços" : "Nova lista de preços"} breadcrumbs={[...trail, ...(initial ? [{ label: initial.data.name, href: recordHref(initial.data.id, returnTo) }] : []), { label: initial ? "Editar" : "Nova lista" }]} back={{ href: initial ? recordHref(initial.data.id, returnTo) : returnTo, label: "Voltar" }} description="Defina os preços desta lista. O preço base do catálogo permanece igual." />
    <section className="form-section min-w-0 space-y-5"><Lookup endpoint="products" label="produto" searchOnly disabled={frozen || items.length >= 1000} choose={choose} /><form className="space-y-5" onChange={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); setError("")
      if (command.uncertain) {
        const confirmed = await command.send<Snapshot>(initial ? `/api/erp/price-lists/${initial.data.id}` : "/api/erp/price-lists", tenantId, {})
        if (confirmed && confirmed.tenantId === tenantId) { setDirty(false); router.replace(recordHref(confirmed.data.id, returnTo)) }
        return
      }
      const form = new FormData(event.currentTarget)
      const code = String(form.get("code") || "").trim(); const name = String(form.get("name") || "").trim()
      const validFrom = String(form.get("validFrom") || "") || null; const validUntil = String(form.get("validUntil") || "") || null
      if (!code || !name || !items.length || items.some(item => !normalizeDecimal(item.price, 2))) { setError("Informe código, nome e ao menos um produto com preço válido."); return }
      if (validFrom && validUntil && validFrom > validUntil) { setError("O fim da vigência deve ser igual ou posterior ao início."); return }
      const saved = await command.send<Snapshot>(initial ? `/api/erp/price-lists/${initial.data.id}` : "/api/erp/price-lists", tenantId, { code, name, status: String(form.get("status")), validFrom, validUntil, notes: String(form.get("notes") || "").trim() || null, items: items.map(item => ({ productId: item.productId, price: normalizeDecimal(item.price, 2) })) }, initial ? etag : "", initial ? "PUT" : "POST")
      if (saved && saved.tenantId === tenantId) { setDirty(false); router.replace(recordHref(saved.data.id, returnTo)) }
    }}>
      <fieldset disabled={frozen} className="min-w-0 space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2">Código<Input name="code" required maxLength={40} defaultValue={initial?.data.code || ""} /></label><label className="grid gap-2">Nome da lista<Input name="name" required maxLength={160} defaultValue={initial?.data.name || ""} /></label><label className="grid gap-2">Situação<select name="status" className="min-h-10 rounded-lg border px-3" defaultValue={initial?.data.status || "active"}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label><label className="grid gap-2">Início da vigência<Input type="date" name="validFrom" defaultValue={initial?.data.validFrom || ""} /></label><label className="grid gap-2">Fim da vigência<Input type="date" name="validUntil" defaultValue={initial?.data.validUntil || ""} /></label></div>

      <div className="overflow-x-auto"><DataTable><caption className="sr-only">Produtos da lista</caption><thead><tr><th className={cell}>Produto</th><th className={cell}>Preço</th><th className={cell}><span className="sr-only">Ações</span></th></tr></thead><tbody>{items.map(item => <tr className="border-t" key={item.productId}><td className={cell}>{item.name}<span className="block text-xs text-muted-foreground">{item.sku} · {item.unit}</span></td><td className={cell}><Input aria-label={`Preço de ${item.name}`} inputMode="decimal" required value={item.price} onChange={event => setItems(old => old.map(row => row.productId === item.productId ? { ...row, price: event.target.value } : row))} /></td><td className={cell}><Button type="button" variant="outline" onClick={() => { setItems(old => old.filter(row => row.productId !== item.productId)); setDirty(true) }}>Remover {item.name}</Button></td></tr>)}</tbody></DataTable></div>{!items.length && <p>Selecione os produtos para definir seus preços.</p>}
      <label className="grid gap-2">Observações<textarea name="notes" maxLength={10000} className="min-h-24 rounded-lg border p-3" defaultValue={initial?.data.notes || ""} /></label></fieldset>
      {(error || command.error) && <div role="alert"><RequestError message={error || command.error} status={error ? undefined : command.status} /></div>}
      {command.stale && <Button type="button" variant="outline" onClick={() => { if (window.confirm("Recarregar e descartar as alterações locais?")) { command.reset(); reload() } }}>Recarregar lista</Button>}
      {command.uncertain && <p role="status">Resultado pendente. Repita a confirmação para consultar o mesmo envio.</p>}
      <Button type="submit" disabled={command.busy || command.stale || !items.length}>{command.busy ? "Salvando…" : command.uncertain ? "Repetir confirmação" : "Salvar lista"}</Button>
    </form></section></>
}
