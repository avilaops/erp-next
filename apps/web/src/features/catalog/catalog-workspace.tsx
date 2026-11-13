"use client"
import { Pagination } from "@/components/workspace/pagination"
import { DataTable } from "@/components/workspace/data-table"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { normalizeDecimal } from "@/lib/decimal-input"

import { AccessLink } from "@/components/feedback/session-recovery"

import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { RecordCompany } from "@/components/record-company"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"
import { readProductDraft, writeProductDraft, type ProductInput, type ProductCommand, type ProductDraft } from "./product-draft"
import { parseCatalogQuery, catalogQueryString, catalogMaxOffset, type CatalogQuery } from "./catalog-query"

import { ProductPhoto } from "./product-photo"
import { CatalogProfile } from "./catalog-profile"
import { CatalogColorPhotos, CatalogPaletteReference } from "./catalog-color-photos"
import { catalogPaletteFor } from "./catalog-color-photo-model"
import { ProductCategory } from "./product-category"
import { ProductThumbnail } from "./product-thumbnail"
import { useResource } from "@/hooks/use-operation"
import type { PersonalPreferences } from "@/features/preferences/system/system-preferences"
import { commercialMoney } from "@/features/sales/order-presentation"
import "./catalog-workspace.css"

type ProductList = Schema<"ProductList">
type Snapshot = Schema<"ProductSnapshot">
const empty: ProductInput = { sku: "", name: "", unit: "UN", ncm: null, cest: null, basePrice: "0.00", status: "active", structureColors: [], swingArmColors: [], finishingPalette: "", upholsteryColors: [], plateHolderColors: [], plateHolderTypes: [] }
export const catalogLink = "font-medium text-primary underline underline-offset-4"

const priceForRequest = normalizeDecimal

export function CatalogList() {
  const params = useSearchParams()
  const preferences = useResource<PersonalPreferences>("/api/erp/preferences")
  const size = preferences.value?.data.productPageSize ?? 25
  const query = parseCatalogQuery(params, size)
  if (preferences.loading) return <p role="status">Carregando preferências do catálogo…</p>
  return <>{preferences.error && <p role="status" className="mb-4 text-sm text-muted-foreground">Preferência pessoal indisponível. O catálogo usa 25 produtos por página.</p>}<CatalogResults key={size} query={query} pageSize={size} /></>
}

function CatalogResults({ query, pageSize }: { query: CatalogQuery; pageSize: number }) {
  const { q, status, offset, categoryId } = query
  const [result, setResult] = useState<ProductList | null>(null)
  const [error, setError] = useState("")
  const [responseStatus, setResponseStatus] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let requestStatus = 0
    const params = new URLSearchParams({ q, offset: String(offset), limit: String(pageSize) })
    if (status) params.set("status", status)
    if (categoryId) params.set("category_id", categoryId)
    erpFetch(`/api/erp/products?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      requestStatus = response.status
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Catálogo indisponível")
      if (!controller.signal.aborted) { setResult(data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message); setResponseStatus(requestStatus) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [q, status, offset, retry, pageSize, categoryId])
  function navigate(next: CatalogQuery) {
    const search = catalogQueryString(next)
    if (search === catalogQueryString(query)) { setLoading(true); setRetry(value => value + 1); return }
    setLoading(true); window.history.pushState(null, "", `/cadastros/produtos${search ? `?${search}` : ""}`)
  }
  return <div className="catalog-workspace">
    <section className="form-section space-y-3 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 sm:gap-3 sm:pb-4"><div><h2 className="text-lg font-semibold tracking-tight">Catálogo de produtos</h2><p className="mt-1 hidden text-sm text-muted-foreground sm:block">Localize, consulte e edite os produtos da empresa ativa.</p></div>{result?.canEdit && <Link className={catalogLink} href="/cadastros/produtos/novo">Novo produto</Link>}</div>
      <form className="grid min-w-0 grid-cols-2 items-end gap-2 sm:gap-3 xl:grid-cols-[minmax(18rem,1fr)_minmax(12rem,0.45fr)_9rem_auto]" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget)
        navigate(parseCatalogQuery(new URLSearchParams({ q: String(form.get("q") || ""), status: String(form.get("status") || ""), category_id: categoryId || "" })))
      }}>
        <label className="col-span-2 min-w-0 space-y-1 xl:col-span-1">Buscar nome ou SKU<SearchInput onSearch={(q, form) => navigate(parseCatalogQuery(new URLSearchParams({ q, status: form ? String(new FormData(form).get("status") || "") : status, category_id: categoryId || "" })))} name="q" maxLength={160} defaultValue={q} /></label>
        <ProductCategory all tenantId={result?.tenantId} value={categoryId || ""} onChange={categoryId => navigate({ ...query, categoryId, offset: 0 })} />
        <label className="space-y-2">Situação<select key={status} name="status" defaultValue={status} className="block h-10 w-full rounded-lg border bg-background px-3"><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
        <Button className="col-span-2 h-10 justify-self-end xl:col-span-1" type="submit" disabled={loading}>Buscar</Button>
      </form>
      {loading ? <p role="status">Carregando produtos…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p>{responseStatus === 401 && <AccessLink className={catalogLink}>Entrar com Avila Ops</AccessLink>}<Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} produto(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <>
          <div className="workspace-list-scroll" role="region" aria-label="Lista de produtos" tabIndex={0}><DataTable aria-label="Catálogo de produtos" className="catalog-product-table table-fixed [&_td]:px-2 [&_th]:px-2 lg:[&_td]:px-4 lg:[&_th]:px-4">
            <thead><tr><th scope="col" className="w-[59%] lg:w-[42%]">Produto</th><th scope="col" className="hidden lg:table-cell lg:w-[18%]">SKU</th><th scope="col" className="hidden lg:table-cell lg:w-[10%]">Unidade</th><th scope="col" className="w-[41%] text-right lg:w-[18%]">Preço base</th><th scope="col" className="hidden lg:table-cell lg:w-[12%]">Situação</th></tr></thead>
            <tbody>{result.data.map(product => <tr key={product.id}>
              <th scope="row" className="text-left align-top font-normal"><div className="flex min-w-0 items-start gap-2 lg:items-center lg:gap-3">
                <span className="shrink-0 [&>span]:size-10 [&_img]:size-10 lg:[&>span]:size-14 lg:[&_img]:size-14"><ProductThumbnail key={`${product.id}:${product.revision}`} id={product.id} name={product.name} hasPhoto={product.hasPhoto} tenantId={result.tenantId} decorative /></span>
                <div className="min-w-0 [overflow-wrap:anywhere]"><Link className={`${catalogLink} catalog-product-name`} href={`/cadastros/produtos/${product.id}`} title={product.name}>{product.name}</Link></div>
              </div><p className="mt-1 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere] lg:hidden">SKU {product.sku} · {product.unit} · {product.status === "active" ? "Ativo" : "Arquivado"}</p></th>
              <td className="hidden text-muted-foreground [overflow-wrap:anywhere] lg:table-cell">{product.sku}</td><td className="hidden [overflow-wrap:anywhere] lg:table-cell">{product.unit}</td>
              <td className="text-right align-top font-semibold tabular-nums [overflow-wrap:anywhere]">{commercialMoney(product.basePrice)}</td><td className="hidden text-sm text-muted-foreground lg:table-cell">{product.status === "active" ? "Ativo" : "Arquivado"}</td>
            </tr>)}</tbody>
          </DataTable></div>
        </> : <p>Nenhum produto encontrado.</p>}
        <Pagination offset={offset} pageSize={pageSize} total={result.total} maxOffset={catalogMaxOffset} showPageSize onOffsetChange={offset => navigate({ ...query, offset })} />
        {offset >= catalogMaxOffset && offset + pageSize < result.total && <p role="status">Refine a busca para acessar outros resultados.</p>}
      </>}
    </section>
  </div>
}

export function CatalogEditor({ id, view = false, draftScope }: { id?: string; view?: boolean; draftScope: string }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ProductInput>({ ...empty })
  const [baseline, setBaseline] = useState(JSON.stringify(empty))
  const [etag, setEtag] = useState("")
  const [error, setError] = useState("")
  const [responseStatus, setResponseStatus] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const [recovered, setRecovered] = useState(false)
  const [storageError, setStorageError] = useState("")
  const [storageInvalid, setStorageInvalid] = useState(false)
  const command = useRef<ProductCommand | null>(null)
  const pending = useRef(false)
  const active = useRef(true)
  const storageKey = `erp:product-draft:v1:${draftScope}:${id || "new"}`
  const dirty = JSON.stringify(draft) !== baseline
  useNavigationGuard(!view && (dirty || uncertain || saving) ? "Há uma edição de produto pendente. Sair desta tela sem concluir a gravação?" : null)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    erpFetch(id ? `/api/erp/products/${id}` : "/api/erp/products?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!controller.signal.aborted) setResponseStatus(response.status)
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      const data: ProductInput = id ? { sku: value.data.sku, name: value.data.name, unit: value.data.unit, ncm: value.data.ncm, cest: value.data.cest, basePrice: value.data.basePrice, status: value.data.status, structureColors: value.data.structureColors || [], swingArmColors: value.data.swingArmColors || [], finishingPalette: value.data.finishingPalette || "", upholsteryColors: value.data.upholsteryColors || [], plateHolderColors: value.data.plateHolderColors || [], plateHolderTypes: value.data.plateHolderTypes || [], photoDataUrl: value.data.photoDataUrl || "", categoryId: value.data.categoryId || "" } : { ...empty }
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      const stored = !view && value.canEdit ? readProductDraft(storageKey) : { value: null, error: "" }
      const recoveredDraft = stored.value
      const serverEtag = response.headers.get("etag") || ""
      const changedRevision = !!id && !!recoveredDraft && recoveredDraft.etag !== serverEtag
      setStorageInvalid(!!stored.error)
      command.current = recoveredDraft?.command || null
      setStorageError(stored.error); setRecovered(!!recoveredDraft)
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: id ? value.data : { ...empty, id: "", revision: 0, hasPhoto: false, photoUrl: null, upholsteryConfigurable: value.upholsteryConfigurable } })
      setDraft(recoveredDraft ? { ...data, ...recoveredDraft.draft } : data); setBaseline(recoveredDraft?.baseline || JSON.stringify(data)); setEtag(recoveredDraft?.etag || serverEtag)
      setError(changedRevision ? "O produto mudou no servidor. Sua edição foi recuperada; confira os dados antes de recarregar o cadastro." : recoveredDraft?.conflict ? "A gravação anterior precisa ser conferida. Sua edição foi recuperada; recarregue o cadastro para conferir o estado do servidor." : "")
      setConflict(changedRevision || !!recoveredDraft?.conflict); setUncertain(!!recoveredDraft?.uncertain)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry, storageKey, view])
  useEffect(() => {
    if (loading || view || !snapshot?.canEdit || storageInvalid || saving) return
    const value: ProductDraft | null = dirty || uncertain ? { version: 1, draft, baseline, etag, uncertain, conflict, command: command.current } : null
    if (!writeProductDraft(storageKey, value)) {
      setStorageError("Não foi possível proteger o rascunho nesta aba. Libere o armazenamento do navegador antes de sair ou salvar.")
    }
  }, [draft, baseline, etag, dirty, uncertain, conflict, saving, loading, snapshot, storageKey, storageInvalid, view])
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!snapshot?.canEdit || pending.current || conflict || view || photoBusy || storageInvalid) return
    const basePrice = priceForRequest(draft.basePrice)
    if (basePrice === null) { setSaved(false); setError("Informe um preço válido com até duas casas decimais, como 12,50. Não use separador de milhar."); return }
    const normalizeColors = (colors: string[]) => colors.map(color => color.trim()).filter(Boolean)
    const body = JSON.stringify({ ...draft, basePrice, structureColors: normalizeColors(draft.structureColors || []), swingArmColors: normalizeColors(draft.swingArmColors || []), upholsteryColors: snapshot.data.upholsteryConfigurable === false ? undefined : normalizeColors(draft.upholsteryColors || []), plateHolderColors: normalizeColors(draft.plateHolderColors || []), plateHolderTypes: normalizeColors(draft.plateHolderTypes || []) })
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body }
    // Persist the in-flight command before dispatch. A reload must not create a new command.
    if (!writeProductDraft(storageKey, { version: 1, draft, baseline, etag, uncertain: !id, conflict: !!id, command: command.current })) {
      setStorageError("Não foi possível proteger a confirmação da gravação. Libere o armazenamento desta aba e tente novamente."); return
    }
    pending.current = true; setSaving(true); setSaved(false); setError(""); setStorageError("")
    try {
      const response = await erpFetch(id ? `/api/erp/products/${id}` : "/api/erp/products", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) }, body: id ? body : command.current!.body })
      const value = await response.json()
      if (!response.ok) {
        setError(value.title || "Não foi possível salvar")
        if (id) setConflict(response.status === 412 || (response.status === 409 && value.type !== "https://erp.avilaops.com/problems/domain_conflict") || response.status >= 500)
        else if (response.status >= 500) setUncertain(true)
        return
      }
      writeProductDraft(storageKey, null)
      setUncertain(false); command.current = null; setBaseline(JSON.stringify(draft)); setSaved(true); setRecovered(false)
      if (!id) { if (active.current) router.replace(`/cadastros/produtos/${value.data.id}`) }
      else { setSnapshot(value); setEtag(response.headers.get("etag") || "") }
    } catch { setError("Não foi possível confirmar a gravação. Sua edição foi preservada."); if (id) setConflict(true); else setUncertain(true) }
    finally { pending.current = false; setSaving(false) }
  }
  function reload() {
    if (saving || uncertain) return
    if ((dirty || recovered || storageInvalid) && !window.confirm("Descartar sua edição e carregar o cadastro atual do servidor?")) return
    if (!writeProductDraft(storageKey, null)) { setStorageError("Não foi possível descartar o rascunho. Verifique o armazenamento desta aba."); return }
    setStorageInvalid(false); command.current = null
    setLoading(true); setResponseStatus(0); setRetry(value => value + 1); setSaved(false); setRecovered(false); setStorageError("")
  }
  return <div className="catalog-workspace">
    <PageHeader breadcrumbs={[
      { label: "Cadastros", href: "/cadastros" },
      { label: "Produtos", href: "/cadastros/produtos" },
      ...(id ? [{ label: snapshot?.data?.name || "Produto", href: `/cadastros/produtos/${id}` }] : []),
      ...(!view ? [{ label: id ? "Editar produto" : "Novo produto" }] : []),
    ]} title={view ? snapshot?.data?.name || "Produto" : id ? "Editar produto" : "Novo produto"} />
    <section className="form-section mt-3 space-y-3 sm:mt-5 sm:space-y-5">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p>{responseStatus === 401 && <AccessLink className={catalogLink}>Entrar com Avila Ops</AccessLink>}<Button onClick={reload}>Tentar novamente</Button></> : <>
        <RecordCompany key={snapshot.tenantId} tenantId={snapshot.tenantId} />
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar produtos.</p>}
        {recovered && <p role="status">Rascunho recuperado nesta aba. Confira os dados antes de salvar.</p>}
        {storageError && <p role="alert">{storageError}</p>}
        {!view && snapshot.canEdit && (dirty || recovered || storageError) && <Button variant="outline" onClick={reload} disabled={saving || uncertain}>Descartar rascunho</Button>}
        {saved && <p role="status">Produto salvo no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view ? <><div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5"><ProductPhoto value={snapshot.data.photoUrl || snapshot.data.photoDataUrl || undefined} readOnly /><dl role="group" aria-label="Dados do produto" className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-3">{[["SKU", snapshot.data.sku], ["Unidade", snapshot.data.unit], ["Preço base", commercialMoney(snapshot.data.basePrice)], ["NCM", snapshot.data.ncm || "Não informado"], ["CEST", snapshot.data.cest || "Não informado"], ["Situação", snapshot.data.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div key={label} className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl></div>{snapshot.canEdit && <div className="flex flex-wrap gap-x-4 gap-y-2"><Link className={catalogLink} href={`/cadastros/produtos/${id}/editar`}>Editar produto</Link><Link className={catalogLink} href={`/cadastros/produtos/${id}/custos`}>Custos e linha comercial</Link></div>}</> : <form className="space-y-3 sm:space-y-4" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid min-w-0 grid-cols-2 items-end gap-3">{([ ["name", "Nome do produto", 200], ["sku", "SKU", 80], ["unit", "Unidade", 6], ["basePrice", "Preço base (R$)", 15], ["ncm", "NCM (8 dígitos, opcional)", 8], ["cest", "CEST (7 dígitos, opcional)", 7] ] as const).map(([field, label, max]) => <label key={field} className={`grid min-w-0 gap-1 ${field === "name" ? "col-span-2" : ""}`}>{label}<Input aria-label={label} inputMode={field === "basePrice" ? "decimal" : field === "ncm" || field === "cest" ? "numeric" : undefined} aria-describedby={field === "basePrice" ? "product-price-help" : undefined} value={draft[field] || ""} maxLength={max} required={field !== "ncm" && field !== "cest"} onChange={event => setDraft({ ...draft, [field]: event.target.value || (field === "ncm" || field === "cest" ? null : "") })} /></label>)}<label className="grid min-w-0 gap-1">Situação<select className="block h-9 w-full rounded-lg border bg-background px-3" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label><div className="col-span-2 min-w-0"><ProductCategory tenantId={snapshot.tenantId} value={draft.categoryId || ""} disabled={!snapshot.canEdit || saving || uncertain} onChange={categoryId => setDraft(previous => ({ ...previous, categoryId }))} /></div></fieldset>
          <p id="product-price-help" className="text-xs text-muted-foreground">Preço sem separador de milhar, com até duas casas decimais. Exemplo: 12,50.</p>
          <ProductPhoto compact value={snapshot.data.photoUrl || draft.photoDataUrl || undefined} readOnly={!!snapshot.data.photoUrl} disabled={!snapshot.canEdit || saving || uncertain} onBusy={setPhotoBusy} onChange={photoDataUrl => setDraft(previous => ({ ...previous, photoDataUrl }))} />
          <details open={Boolean(id)} className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer font-medium">Acabamentos disponíveis do equipamento</summary><fieldset id="product-colors" disabled={!snapshot.canEdit || saving || uncertain} className="mt-3 min-w-0 scroll-mt-20 space-y-2">
            <legend className="sr-only">Acabamentos disponíveis do equipamento</legend>
            <label className="grid min-w-0 gap-1 text-sm">Catálogo de acabamentos<select className="h-9 min-w-0 rounded-lg border bg-background px-2" value={draft.finishingPalette || ""} onChange={event => setDraft(previous => ({ ...previous, finishingPalette: event.target.value }))}><option value="">Sem paleta de catálogo</option><option value="dhz-hammerforce-pro">DHZ · HammerForce Pro</option><option value="dhz-sforce">DHZ · Hammer S-FORCE</option></select></label>
            <p className="text-xs text-muted-foreground">Uma cor por linha. Estrutura, braços e estofado têm escolhas independentes.</p>
            {snapshot.data.upholsteryConfigurable === false && <p className="text-xs text-muted-foreground">Estofado padrão nesta empresa.</p>}
            <div className="grid min-w-0 grid-cols-2 gap-3">
              {([["structureColors", "Cores da estrutura"], ["swingArmColors", "Cores dos braços"], ...(snapshot.data.upholsteryConfigurable === false ? [] : [["upholsteryColors", "Cores do estofado"] as const])] as const).map(([field, label]) => <label key={field} className="grid min-w-0 gap-1">{label}<textarea rows={2} maxLength={1951} className="catalog-finishing-input w-full min-w-0 rounded-lg border border-input bg-background text-base" value={(draft[field] || []).join("\n")} onChange={event => setDraft({ ...draft, [field]: event.target.value.split("\n") })} placeholder="Uma cor por linha" /></label>)}
            </div>
            <fieldset className="min-w-0 border-t pt-2"><legend className="px-1 text-sm font-medium">Anilheiro — opções no fechamento</legend><div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">{(["Standard", "Olímpico"] as const).map(type => <label key={type} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={(draft.plateHolderTypes || []).includes(type)} onChange={event => { const checked = event.target.checked; setDraft(previous => { const selected = new Set(previous.plateHolderTypes || []); if (checked) selected.add(type); else selected.delete(type); return { ...previous, plateHolderTypes: ["Standard", "Olímpico"].filter(value => selected.has(value)) } }) }} />{type}</label>)}</div><p className="mt-1 text-xs text-muted-foreground">As opções marcadas ficam disponíveis no pedido e na proposta. Sem opções marcadas: Não se aplica.</p></fieldset>
          </fieldset></details>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro produto.</p>}
          <Button type="submit" disabled={saving || photoBusy || conflict || storageInvalid || !snapshot.canEdit || (!dirty && !!id)}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar produto"}</Button>
        </form>}
        {view && <ProductCategory tenantId={snapshot.tenantId} value={snapshot.data.categoryId || ""} disabled onChange={() => {}} />}
        {view && <details className="min-w-0 space-y-3 rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">Acabamentos disponíveis</summary>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {([["Estrutura", "structure", snapshot.data.structureColors], ["Braços", "swingArm", snapshot.data.swingArmColors], ["Estofado", "upholstery", snapshot.data.upholsteryColors]] as const).map(([label, part, colors]) => <div key={part} className={`min-w-0 space-y-2 ${part === "upholstery" ? "sm:col-span-2" : ""}`}>
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              {part === "upholstery" && snapshot.data.upholsteryConfigurable === false ? <p className="text-sm">Estofado padrão</p> : colors?.length ? <CatalogColorPhotos label={label} part={part} options={colors} palette={catalogPaletteFor(snapshot.data.finishingPalette)} readOnly showSource={false} /> : <p className="text-sm">Sem opções cadastradas</p>}
            </div>)}
          </div>
          <p className="text-xs"><span className="text-muted-foreground">Anilheiro: </span>{snapshot.data.plateHolderTypes?.length ? snapshot.data.plateHolderTypes.join(" ou ") : "Não se aplica"}</p>
          <CatalogPaletteReference palette={catalogPaletteFor(snapshot.data.finishingPalette)} />
        </details>}
      </>}
      {id && snapshot && <CatalogProfile key={`${snapshot.tenantId}:${id}`} id={id} tenantId={snapshot.tenantId} canEdit={snapshot.canEdit} edit={!view} />}
    </section>
  </div>
}
