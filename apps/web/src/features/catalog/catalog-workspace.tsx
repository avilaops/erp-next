"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductPhoto } from "./product-photo"
import { ProductThumbnail } from "./product-thumbnail"

type ProductInput = { sku: string; name: string; unit: string; ncm: string | null; cest: string | null; basePrice: string; status: string; structureColors: string[]; upholsteryColors: string[]; photoDataUrl?: string }
type Product = ProductInput & { id: string; revision: number; hasPhoto?: boolean }
type ProductList = { tenantId: string; canEdit: boolean; data: Product[]; total: number }
type Snapshot = { tenantId: string; canEdit: boolean; data: Product }
const empty: ProductInput = { sku: "", name: "", unit: "UN", ncm: null, cest: null, basePrice: "0.00", status: "active", structureColors: [], upholsteryColors: [] }
export const catalogLink = "font-medium text-primary underline underline-offset-4"

function priceForRequest(value: string): string | null {
  const match = /^(0|[1-9][0-9]{0,11})(?:[.,]([0-9]{1,2}))?$/.exec(value.trim())
  return match ? `${match[1]}.${(match[2] || "").padEnd(2, "0")}` : null
}

export function CatalogList() {
  const [query, setQuery] = useState({ q: "", status: "", offset: 0 })
  const [result, setResult] = useState<ProductList | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
    if (query.status) params.set("status", query.status)
    fetch(`/api/erp/products?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Catálogo indisponível")
      if (!controller.signal.aborted) { setResult(data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, retry])
  return <div>
    <PageHeader eyebrow="Cadastros" title="Produtos" description="Catálogo da empresa ativa. NCM e CEST informados não representam classificação fiscal validada." />
    <section className="form-section space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Catálogo de produtos</h2>{result?.canEdit && <Link className={catalogLink} href="/cadastros/produtos/novo">Novo produto</Link>}</div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); setLoading(true)
        setQuery({ q: String(form.get("q") || ""), status: String(form.get("status") || ""), offset: 0 })
      }}>
        <label className="min-w-48 flex-1 space-y-2">Buscar nome ou SKU<Input name="q" maxLength={160} /></label>
        <label className="space-y-2">Situação<select name="status" className="block h-8 rounded-lg border bg-background px-3"><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
        <Button type="submit" disabled={loading}>Buscar</Button>
      </form>
      {loading ? <p role="status">Carregando produtos…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p><Link className={catalogLink} href="/entrar">Entrar com Ávila Ops</Link><Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} produto(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Produto</th><th className="p-3">SKU</th><th className="p-3">Unidade</th><th className="p-3">Preço base</th><th className="p-3">Situação</th></tr></thead><tbody>{result.data.map(product => <tr key={product.id} className="border-b"><td className="p-3"><Link className={`${catalogLink} flex items-center gap-3`} href={`/cadastros/produtos/${product.id}`}><ProductThumbnail key={`${product.id}:${product.revision}`} id={product.id} name={product.name} hasPhoto={product.hasPhoto} tenantId={result.tenantId} /><span>{product.name}</span></Link></td><td className="p-3">{product.sku}</td><td className="p-3">{product.unit}</td><td className="whitespace-nowrap p-3">R$ {product.basePrice.replace(".", ",")}</td><td className="p-3">{product.status === "active" ? "Ativo" : "Arquivado"}</td></tr>)}</tbody></table></div> : <p>Nenhum produto encontrado.</p>}
        <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => { setLoading(true); setQuery({ ...query, offset: Math.max(0, query.offset - 25) }) }}>Anterior</Button><span className="text-sm">Página {Math.floor(query.offset / 25) + 1}</span><Button variant="outline" disabled={query.offset + 25 >= result.total} onClick={() => { setLoading(true); setQuery({ ...query, offset: query.offset + 25 }) }}>Próxima</Button></div>
      </>}
    </section>
  </div>
}

export function CatalogEditor({ id, view = false }: { id?: string; view?: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ProductInput>({ ...empty })
  const [baseline, setBaseline] = useState(JSON.stringify(empty))
  const [etag, setEtag] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const command = useRef<{ key: string; body: string } | null>(null)
  const pending = useRef(false)
  const dirty = JSON.stringify(draft) !== baseline
  useEffect(() => {
    const controller = new AbortController()
    fetch(id ? `/api/erp/products/${id}` : "/api/erp/products?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      const data: ProductInput = id ? { sku: value.data.sku, name: value.data.name, unit: value.data.unit, ncm: value.data.ncm, cest: value.data.cest, basePrice: value.data.basePrice, status: value.data.status, structureColors: value.data.structureColors || [], upholsteryColors: value.data.upholsteryColors || [], photoDataUrl: value.data.photoDataUrl || "" } : { ...empty }
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: value.data }); setDraft(data); setBaseline(JSON.stringify(data)); setEtag(response.headers.get("etag") || ""); setError(""); setConflict(false); setUncertain(false)
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, retry])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, uncertain])
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!snapshot?.canEdit || pending.current || conflict || view || photoBusy) return
    const basePrice = priceForRequest(draft.basePrice)
    if (basePrice === null) { setSaved(false); setError("Informe um preço válido com até duas casas decimais, como 12,50. Não use separador de milhar."); return }
    const normalizeColors = (colors: string[]) => colors.map(color => color.trim()).filter(Boolean)
    const body = JSON.stringify({ ...draft, basePrice, structureColors: normalizeColors(draft.structureColors), upholsteryColors: normalizeColors(draft.upholsteryColors) })
    pending.current = true; setSaving(true); setSaved(false); setError("")
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body }
    try {
      const response = await fetch(id ? `/api/erp/products/${id}` : "/api/erp/products", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) }, body: id ? body : command.current!.body })
      const value = await response.json()
      if (!response.ok) {
        setError(value.title || "Não foi possível salvar")
        if (id) setConflict(response.status === 412 || (response.status === 409 && value.type !== "https://erp.avilaops.com/problems/domain_conflict") || response.status >= 500)
        else if (response.status >= 500) setUncertain(true)
        return
      }
      setUncertain(false); command.current = null; setBaseline(JSON.stringify(draft)); setSaved(true)
      if (!id) router.replace(`/cadastros/produtos/${value.data.id}`)
      else { setSnapshot(value); setEtag(response.headers.get("etag") || "") }
    } catch { setError("Não foi possível confirmar a gravação. Sua edição foi preservada."); if (id) setConflict(true); else setUncertain(true) }
    finally { pending.current = false; setSaving(false) }
  }
  function reload() { if (!dirty || window.confirm("Descartar sua edição e carregar o cadastro atual do servidor?")) { setLoading(true); setRetry(value => value + 1); setSaved(false) } }
  return <div>
    <PageHeader eyebrow="Cadastros · Produtos" title={view ? snapshot?.data?.name || "Produto" : id ? "Editar produto" : "Novo produto"} description="Preço base e classificação declarada. Condições negociadas e cálculo fiscal pertencem aos respectivos fluxos." />
    <Link className={catalogLink} href="/cadastros/produtos" onClick={event => { if ((dirty || uncertain) && !window.confirm("Sair sem confirmar esta edição?")) event.preventDefault() }}>Voltar ao catálogo</Link>
    <section className="form-section mt-5 space-y-5">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Link className={catalogLink} href="/entrar">Entrar com Ávila Ops</Link><Button onClick={reload}>Tentar novamente</Button></> : <>
        <p className="text-sm text-muted-foreground">Empresa {snapshot.tenantId}{id ? ` · Revisão ${snapshot.data.revision}` : ""}</p>
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar produtos.</p>}
        {saved && <p role="status">Produto salvo no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view ? <><dl className="grid gap-4 sm:grid-cols-2">{[["SKU", snapshot.data.sku], ["Unidade", snapshot.data.unit], ["Preço base", `R$ ${snapshot.data.basePrice.replace(".", ",")}`], ["NCM", snapshot.data.ncm || "Não informado"], ["CEST", snapshot.data.cest || "Não informado"], ["Situação", snapshot.data.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>{snapshot.canEdit && <Link className={catalogLink} href={`/cadastros/produtos/${id}/editar`}>Editar produto</Link>}</> : <form className="space-y-5" onSubmit={save}>
          <ProductPhoto value={draft.photoDataUrl} disabled={!snapshot.canEdit || saving || uncertain} onBusy={setPhotoBusy} onChange={photoDataUrl => setDraft(previous => ({ ...previous, photoDataUrl }))} />
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="space-y-4 rounded-xl border p-4">
            <legend className="px-2 font-semibold">Cores disponíveis do equipamento</legend>
            <p className="text-sm text-muted-foreground">Cadastre uma cor por linha, com até 32 opções por acabamento. As opções serão oferecidas ao montar o pedido. Deixe vazio quando não se aplicar.</p>
            <div className="grid gap-4 sm:grid-cols-2">{([["structureColors", "Cores da estrutura"], ["upholsteryColors", "Cores do estofado"]] as const).map(([field, label]) => <label key={field} className="grid gap-2">{label}<textarea rows={4} maxLength={1951} className="w-full min-w-0 rounded-lg border border-input bg-background p-3 text-base" value={draft[field].join("\n")} onChange={event => setDraft({ ...draft, [field]: event.target.value.split("\n") })} placeholder={field === "structureColors" ? "Uma cor de pintura por linha" : "Uma cor de revestimento por linha"} /></label>)}</div>
          </fieldset>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid gap-5 sm:grid-cols-2">{([ ["name", "Nome do produto", 200], ["sku", "SKU", 80], ["unit", "Unidade", 6], ["basePrice", "Preço base (R$)", 15], ["ncm", "NCM (8 dígitos, opcional)", 8], ["cest", "CEST (7 dígitos, opcional)", 7] ] as const).map(([field, label, max]) => <label key={field} className="space-y-2">{label}<Input aria-label={label} inputMode={field === "basePrice" ? "decimal" : field === "ncm" || field === "cest" ? "numeric" : undefined} aria-describedby={field === "basePrice" ? "product-price-help" : undefined} value={draft[field] || ""} maxLength={max} required={field !== "ncm" && field !== "cest"} onChange={event => setDraft({ ...draft, [field]: event.target.value || (field === "ncm" || field === "cest" ? null : "") })} /></label>)}<label className="space-y-2">Situação<select className="block h-8 rounded-lg border bg-background px-3" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label></fieldset>
          <p id="product-price-help" className="text-sm text-muted-foreground">Use vírgula ou ponto, com até duas casas decimais. Exemplo: 12,50. Não use separador de milhar.</p>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro produto.</p>}
          <Button type="submit" disabled={saving || photoBusy || conflict || !snapshot.canEdit || (!dirty && !!id)}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar produto"}</Button>
        </form>}
        {view && <ProductPhoto value={snapshot.data.photoDataUrl} readOnly />}
        {view && <section className="space-y-3 rounded-xl border p-4" aria-label="Cores disponíveis do equipamento"><h2 className="font-semibold">Cores disponíveis</h2>{([["Estrutura", snapshot.data.structureColors], ["Estofado", snapshot.data.upholsteryColors]] as const).map(([label, colors]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p>{colors?.length ? <ul className="mt-2 flex flex-wrap gap-2">{colors.map(color => <li key={color} className="max-w-full break-words rounded-full border px-3 py-1 text-sm">{color}</li>)}</ul> : <p className="mt-1 text-sm">Sem opções cadastradas</p>}</div>)}</section>}
      </>}
    </section>
  </div>
}
