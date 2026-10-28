"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ProductInput = { sku: string; name: string; unit: string; ncm: string | null; cest: string | null; basePrice: string; status: string }
type Product = ProductInput & { id: string; revision: number }
type ProductList = { tenantId: string; canEdit: boolean; data: Product[]; total: number }
type Snapshot = { tenantId: string; canEdit: boolean; data: Product }
const empty: ProductInput = { sku: "", name: "", unit: "UN", ncm: null, cest: null, basePrice: "0.00", status: "active" }
export const catalogLink = "font-medium text-primary underline underline-offset-4"

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
        {result.data.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Produto</th><th className="p-3">SKU</th><th className="p-3">Unidade</th><th className="p-3">Preço base</th><th className="p-3">Situação</th></tr></thead><tbody>{result.data.map(product => <tr key={product.id} className="border-b"><td className="p-3"><Link className={catalogLink} href={`/cadastros/produtos/${product.id}`}>{product.name}</Link></td><td className="p-3">{product.sku}</td><td className="p-3">{product.unit}</td><td className="whitespace-nowrap p-3">R$ {product.basePrice.replace(".", ",")}</td><td className="p-3">{product.status === "active" ? "Ativo" : "Arquivado"}</td></tr>)}</tbody></table></div> : <p>Nenhum produto encontrado.</p>}
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
      const data: ProductInput = id ? { sku: value.data.sku, name: value.data.name, unit: value.data.unit, ncm: value.data.ncm, cest: value.data.cest, basePrice: value.data.basePrice, status: value.data.status } : { ...empty }
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
    event.preventDefault(); if (!snapshot?.canEdit || pending.current || conflict || view) return
    pending.current = true; setSaving(true); setSaved(false); setError("")
    if (!id && !uncertain) command.current = { key: crypto.randomUUID(), body: JSON.stringify(draft) }
    try {
      const response = await fetch(id ? `/api/erp/products/${id}` : "/api/erp/products", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) }, body: id ? JSON.stringify(draft) : command.current!.body })
      const value = await response.json()
      if (!response.ok) {
        setError(value.title || "Não foi possível salvar")
        if (id) setConflict(response.status === 412 || response.status === 409 || response.status >= 500)
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
          <fieldset disabled={!snapshot.canEdit || saving || uncertain} className="grid gap-5 sm:grid-cols-2">{([ ["name", "Nome do produto", 200], ["sku", "SKU", 80], ["unit", "Unidade", 6], ["basePrice", "Preço base (ponto e duas casas)", 15], ["ncm", "NCM (8 dígitos, opcional)", 8], ["cest", "CEST (7 dígitos, opcional)", 7] ] as const).map(([field, label, max]) => <label key={field} className="space-y-2">{label}<Input value={draft[field] || ""} maxLength={max} required={field !== "ncm" && field !== "cest"} onChange={event => setDraft({ ...draft, [field]: event.target.value || (field === "ncm" || field === "cest" ? null : "") })} /></label>)}<label className="space-y-2">Situação<select className="block h-8 rounded-lg border bg-background px-3" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="active">Ativo</option><option value="archived">Arquivado</option></select></label></fieldset>
          {uncertain && <p role="status">A confirmação está pendente. Conferir repetirá o mesmo comando, sem criar outro produto.</p>}
          <Button type="submit" disabled={saving || conflict || !snapshot.canEdit || (!dirty && !!id)}>{saving ? "Salvando…" : uncertain ? "Conferir gravação" : "Salvar produto"}</Button>
        </form>}
      </>}
    </section>
  </div>
}
