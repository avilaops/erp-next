"use client"

import { GuardedLink as Link, useNavigationGuard } from "@/components/navigation-guard"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readProductDraft, writeProductDraft, type ProductInput, type ProductCommand, type ProductDraft } from "./product-draft"
import { parseCatalogQuery, catalogQueryString, catalogMaxOffset, type CatalogQuery } from "./catalog-query"

type Product = ProductInput & { id: string; revision: number }
type ProductList = { tenantId: string; canEdit: boolean; data: Product[]; total: number }
type Snapshot = { tenantId: string; canEdit: boolean; data: Product }
const empty: ProductInput = { sku: "", name: "", unit: "UN", ncm: null, cest: null, basePrice: "0.00", status: "active" }
export const catalogLink = "font-medium text-primary underline underline-offset-4"

function priceForRequest(value: string): string | null {
  const match = /^(0|[1-9][0-9]{0,11})(?:[.,]([0-9]{1,2}))?$/.exec(value.trim())
  return match ? `${match[1]}.${(match[2] || "").padEnd(2, "0")}` : null
}

export function CatalogList() {
  const params = useSearchParams()
  const query = parseCatalogQuery(params)
  return <CatalogResults key={catalogQueryString(query)} query={query} />
}

function CatalogResults({ query }: { query: CatalogQuery }) {
  const { q, status, offset } = query
  const [result, setResult] = useState<ProductList | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ q, offset: String(offset), limit: "25" })
    if (status) params.set("status", status)
    fetch(`/api/erp/products?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.title || "Catálogo indisponível")
      if (!controller.signal.aborted) { setResult(data); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) { setResult(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [q, status, offset, retry])
  function navigate(next: CatalogQuery) {
    const search = catalogQueryString(next)
    if (search === catalogQueryString(query)) { setLoading(true); setRetry(value => value + 1); return }
    window.history.pushState(null, "", `/cadastros/produtos${search ? `?${search}` : ""}`)
  }
  return <div>
    <PageHeader eyebrow="Cadastros" title="Produtos" description="Catálogo da empresa ativa. NCM e CEST informados não representam classificação fiscal validada." />
    <section className="form-section space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Catálogo de produtos</h2>{result?.canEdit && <Link className={catalogLink} href="/cadastros/produtos/novo">Novo produto</Link>}</div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget)
        navigate(parseCatalogQuery(new URLSearchParams({ q: String(form.get("q") || ""), status: String(form.get("status") || "") })))
      }}>
        <label className="min-w-48 flex-1 space-y-2">Buscar nome ou SKU<Input name="q" maxLength={160} defaultValue={q} /></label>
        <label className="space-y-2">Situação<select name="status" defaultValue={status} className="block h-8 rounded-lg border bg-background px-3"><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
        <Button type="submit" disabled={loading}>Buscar</Button>
      </form>
      {loading ? <p role="status">Carregando produtos…</p> : error ? <div role="alert" className="space-y-3"><p>{error}</p><Link className={catalogLink} href="/entrar">Entrar com Ávila Ops</Link><Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</Button></div> : result && <>
        <p className="text-sm text-muted-foreground">{result.total} produto(s) · {result.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
        {result.data.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Produto</th><th className="p-3">SKU</th><th className="p-3">Unidade</th><th className="p-3">Preço base</th><th className="p-3">Situação</th></tr></thead><tbody>{result.data.map(product => <tr key={product.id} className="border-b"><td className="p-3"><Link className={catalogLink} href={`/cadastros/produtos/${product.id}`}>{product.name}</Link></td><td className="p-3">{product.sku}</td><td className="p-3">{product.unit}</td><td className="whitespace-nowrap p-3">R$ {product.basePrice.replace(".", ",")}</td><td className="p-3">{product.status === "active" ? "Ativo" : "Arquivado"}</td></tr>)}</tbody></table></div> : <p>Nenhum produto encontrado.</p>}
        <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!offset} onClick={() => navigate({ ...query, offset: Math.max(0, offset - 25) })}>Anterior</Button><span className="text-sm">Página {Math.floor(offset / 25) + 1}</span><Button variant="outline" disabled={offset >= catalogMaxOffset || offset + 25 >= result.total} onClick={() => navigate({ ...query, offset: offset + 25 })}>Próxima</Button></div>
        {offset >= catalogMaxOffset && offset + 25 < result.total && <p role="status">Refine a busca para acessar outros resultados.</p>}
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
    fetch(id ? `/api/erp/products/${id}` : "/api/erp/products?limit=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Cadastro indisponível")
      if (controller.signal.aborted) return
      const data: ProductInput = id ? { sku: value.data.sku, name: value.data.name, unit: value.data.unit, ncm: value.data.ncm, cest: value.data.cest, basePrice: value.data.basePrice, status: value.data.status } : { ...empty }
      if (id && !response.headers.get("etag")) throw new Error("Revisão não recebida")
      const stored = !view && value.canEdit ? readProductDraft(storageKey) : { value: null, error: "" }
      const recoveredDraft = stored.value
      const serverEtag = response.headers.get("etag") || ""
      const changedRevision = !!id && !!recoveredDraft && recoveredDraft.etag !== serverEtag
      setStorageInvalid(!!stored.error)
      command.current = recoveredDraft?.command || null
      setStorageError(stored.error); setRecovered(!!recoveredDraft)
      setSnapshot({ tenantId: value.tenantId, canEdit: value.canEdit, data: value.data })
      setDraft(recoveredDraft?.draft || data); setBaseline(recoveredDraft?.baseline || JSON.stringify(data)); setEtag(recoveredDraft?.etag || serverEtag)
      setError(changedRevision ? "O produto mudou no servidor. Sua edição foi recuperada; confira os dados antes de recarregar o cadastro." : recoveredDraft?.conflict ? "A gravação anterior precisa ser conferida. Sua edição foi recuperada; recarregue o cadastro para conferir o estado do servidor." : "")
      setConflict(changedRevision || !!recoveredDraft?.conflict); setUncertain(!!recoveredDraft?.uncertain)
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
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
    event.preventDefault(); if (!snapshot?.canEdit || pending.current || conflict || view || storageInvalid) return
    const basePrice = priceForRequest(draft.basePrice)
    if (basePrice === null) { setSaved(false); setError("Informe um preço válido com até duas casas decimais, como 12,50. Não use separador de milhar."); return }
    const body = JSON.stringify({ ...draft, basePrice })
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body }
    // Persist the in-flight command before dispatch. A reload must not create a new command.
    if (!writeProductDraft(storageKey, { version: 1, draft, baseline, etag, uncertain: !id, conflict: !!id, command: command.current })) {
      setStorageError("Não foi possível proteger a confirmação da gravação. Libere o armazenamento desta aba e tente novamente."); return
    }
    pending.current = true; setSaving(true); setSaved(false); setError(""); setStorageError("")
    try {
      const response = await fetch(id ? `/api/erp/products/${id}` : "/api/erp/products", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) }, body: id ? body : command.current!.body })
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
    setLoading(true); setRetry(value => value + 1); setSaved(false); setRecovered(false); setStorageError("")
  }
  return <div>
    <PageHeader eyebrow="Cadastros · Produtos" title={view ? snapshot?.data?.name || "Produto" : id ? "Editar produto" : "Novo produto"} description="Preço base e classificação declarada. Condições negociadas e cálculo fiscal pertencem aos respectivos fluxos." />
    <Link className={catalogLink} href="/cadastros/produtos">Voltar ao catálogo</Link>
    <section className="form-section mt-5 space-y-5">
      {loading ? <p role="status">Carregando cadastro…</p> : !snapshot ? <><p role="alert">{error}</p><Link className={catalogLink} href="/entrar">Entrar com Ávila Ops</Link><Button onClick={reload}>Tentar novamente</Button></> : <>
        <p className="text-sm text-muted-foreground">Empresa {snapshot.tenantId}{id ? ` · Revisão ${snapshot.data.revision}` : ""}</p>
        {!snapshot.canEdit && <p role="status">Somente consulta. Solicite permissão para alterar produtos.</p>}
        {recovered && <p role="status">Rascunho recuperado nesta aba. Confira os dados antes de salvar.</p>}
        {storageError && <p role="alert">{storageError}</p>}
        {!view && snapshot.canEdit && (dirty || recovered || storageError) && <Button variant="outline" onClick={reload} disabled={saving || uncertain}>Descartar rascunho</Button>}
        {saved && <p role="status">Produto salvo no servidor.</p>}
        {error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4"><p>{error}</p>{conflict && <Button variant="outline" onClick={reload}>Recarregar cadastro</Button>}</div>}
        {view ? <><dl className="grid gap-4 sm:grid-cols-2">{[["SKU", snapshot.data.sku], ["Unidade", snapshot.data.unit], ["Preço base", `R$ ${snapshot.data.basePrice.replace(".", ",")}`], ["NCM", snapshot.data.ncm || "Não informado"], ["CEST", snapshot.data.cest || "Não informado"], ["Situação", snapshot.data.status === "active" ? "Ativo" : "Arquivado"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>{snapshot.canEdit && <Link className={catalogLink} href={`/cadastros/produtos/${id}/editar`}>Editar produto</Link>}</> : <form className="space-y-5" onSubmit={save}>
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid gap-5 sm:grid-cols-2">{([ ["name", "Nome do produto", 200], ["sku", "SKU", 80], ["unit", "Unidade", 6], ["basePrice", "Preço base (R$)", 15], ["ncm", "NCM (8 dígitos, opcional)", 8], ["cest", "CEST (7 dígitos, opcional)", 7] ] as const).map(([field, label, max]) => <label key={field} className="space-y-2">{label}<Input aria-label={label} inputMode={field === "basePrice" ? "decimal" : field === "ncm" || field === "cest" ? "numeric" : undefined} aria-describedby={field === "basePrice" ? "product-price-help" : undefined} value={draft[field] || ""} maxLength={max} required={field !== "ncm" && field !== "cest"} onChange={event => setDraft({ ...draft, [field]: event.target.value || (field === "ncm" || field === "cest" ? null : "") })} /></label>)}<label className="space-y-2">Situação<select className="block h-8 rounded-lg border bg-background px-3" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label></fieldset>
          <p id="product-price-help" className="text-sm text-muted-foreground">Use vírgula ou ponto, com até duas casas decimais. Exemplo: 12,50. Não use separador de milhar.</p>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro produto.</p>}
          <Button type="submit" disabled={saving || conflict || storageInvalid || !snapshot.canEdit || (!dirty && !!id)}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar produto"}</Button>
        </form>}
      </>}
    </section>
  </div>
}
