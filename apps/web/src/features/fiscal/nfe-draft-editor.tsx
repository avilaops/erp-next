"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { blankDraft, blankItem, itemTotal, productsTotal, submission, type DraftInput, type DraftItem, type FiscalReadiness, type NfeDraft } from "./nfe-draft-model"

type Product = { id: string; sku: string; name: string; unit: string; ncm: string | null; basePrice: string }
type Snapshot = Schema<"DraftSnapshot">
type Preparation = Schema<"OrderPreparation">
const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ")

export function NfeDraftEditor({ id, sourceOrderId }: { id?: string; sourceOrderId?: string }) {
  const router = useRouter()
  const [draft, setDraft] = useState<DraftInput>(blankDraft)
  const [baseline, setBaseline] = useState("")
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [preparation, setPreparation] = useState<Preparation | null>(null)
  const [readiness, setReadiness] = useState<FiscalReadiness | null>(null)
  const [tenant, setTenant] = useState("")
  const [etag, setEtag] = useState("")
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [productError, setProductError] = useState("")
  const [searching, setSearching] = useState(false)
  const [canSearch, setCanSearch] = useState(false)
  const [reload, setReload] = useState(0)
  const command = useRef<{ key: string; body: string } | null>(null)
  const writing = useRef(false)
  const request = useRef<AbortController | null>(null)
  const productRequest = useRef<AbortController | null>(null)
  const dirty = baseline !== "" && baseline !== JSON.stringify(draft)

  useEffect(() => {
    const controller = new AbortController()
    const read = async () => {
      try {
        const paths = ["/api/erp/me", "/api/erp/fiscal/readiness", ...(id ? [`/api/erp/fiscal/nfe/${id}`] : sourceOrderId ? [`/api/erp/fiscal/order-preparations/${sourceOrderId}`] : [])]
        const responses = await Promise.all(paths.map(path => erpFetch(path, { cache: "no-store", signal: controller.signal })))
        const values = await Promise.all(responses.map(response => response.json()))
        for (const [index, response] of responses.entries()) if (!response.ok) throw new Error(values[index].title || "Não foi possível abrir o rascunho")
        if (controller.signal.aborted) return
        const [me, ready, origin] = values
        const current: Snapshot | undefined = id ? origin : undefined
        const proposed: Preparation | undefined = !id && sourceOrderId ? origin : undefined
        if (ready.tenantId !== me.tenant?.id || origin && origin.tenantId !== me.tenant.id) throw new Error("A empresa da sessão mudou. Reabra o rascunho")
        const input: DraftInput = current ? current.data.input : proposed ? { ...blankDraft(), sourceOrderId: proposed.orderId, recipient: proposed.recipient, items: proposed.items.map(item => ({ ...blankItem(), code: item.code, description: item.description, unit: item.unit, ncm: item.ncm || "", quantity: item.quantity, unitPrice: item.unitPrice, grossTotal: item.grossTotal })), productsTotal: proposed.productsTotal } : blankDraft()
        setDraft(input); setBaseline(JSON.stringify(input)); setSnapshot(current || null)
        setPreparation(proposed || null)
        setTenant(me.tenant.id); setReadiness(ready); setCanEdit(me.permissions.includes("fiscal.nfe.manage") && (!current || current.canEdit))
        setCanSearch(me.permissions.includes("catalog.products.read")); setEtag(id ? responses[2].headers.get("etag") || "" : "")
        setBlocked(false); setError(""); setProducts([]); command.current = null
      } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Falha ao abrir o rascunho"); setCanEdit(false) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void read()
    return () => controller.abort()
  }, [id, sourceOrderId, reload])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || uncertain || saving) event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, uncertain, saving])
  useEffect(() => () => { request.current?.abort(); productRequest.current?.abort() }, [])

  function changeItem(index: number, patch: Partial<DraftItem>) {
    setDraft(previous => ({ ...previous, items: previous.items.map((item, position) => position === index ? { ...item, ...patch } : item) }))
  }
  function refresh() {
    if (uncertain && !id) { setError("Confirme a mesma solicitação antes de iniciar outro rascunho"); return }
    if ((dirty || uncertain) && !window.confirm("Recarregar substitui a edição pelos dados do servidor. Deseja continuar?")) return
    setLoading(true); setUncertain(false); setNotice(""); setReload(value => value + 1)
  }
  async function findProducts() {
    productRequest.current?.abort()
    const controller = new AbortController(); productRequest.current = controller
    setSearching(true); setProductError("")
    try {
      const response = await erpFetch(`/api/erp/products?status=active&limit=20&q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Não foi possível buscar os produtos")
      if (!controller.signal.aborted) setProducts(value.data)
    } catch (reason) { if (!controller.signal.aborted) setProductError(reason instanceof Error ? reason.message : "Falha na busca de produtos") }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  function addProduct(product: Product) {
    const item = { ...blankItem(), code: product.sku, description: product.name, unit: product.unit, ncm: product.ncm || "", unitPrice: product.basePrice }
    setDraft(previous => ({ ...previous, items: previous.items.length === 1 && JSON.stringify(previous.items[0]) === JSON.stringify(blankItem()) ? [item] : [...previous.items, item] }))
    setProducts([]); setQuery(""); setNotice("Dados do produto copiados. Confira o NCM e preencha a tributação conforme a instrução fiscal.")
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit || blocked || writing.current || uncertain && !!id || !uncertain && !dirty) return
    let body: string
    try { body = uncertain && command.current ? command.current.body : JSON.stringify(submission(draft)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Confira os valores dos itens"); return }
    if (!id && !command.current) command.current = { key: crypto.randomUUID(), body }
    writing.current = true; setSaving(true); setError(""); setNotice("")
    const controller = new AbortController(); request.current = controller
    let resolved = false
    try {
      const response = await erpFetch(id ? `/api/erp/fiscal/nfe/${id}` : "/api/erp/fiscal/nfe", {
        method: id ? "PUT" : "POST", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant, ...(id ? { "If-Match": etag } : { "Idempotency-Key": command.current!.key }) }, body,
      })
      const value = await response.json()
      if (!response.ok) {
        if (response.status >= 500) { setUncertain(true); throw new Error("Não foi possível confirmar a gravação. Confira o servidor antes de repetir ou confirme a mesma solicitação.") }
        resolved = true; setUncertain(false); command.current = null
        if ([401, 403, 409, 412, 428].includes(response.status)) setBlocked(true)
        throw new Error(value.title || "Não foi possível salvar o rascunho")
      }
      if (value.tenantId !== tenant || !value.data?.id || !response.headers.get("etag")) { setUncertain(true); throw new Error("Resposta sem confirmação do rascunho. Recarregue os dados do servidor") }
      setSnapshot(value); setDraft(value.data.input); setBaseline(JSON.stringify(value.data.input)); setEtag(response.headers.get("etag")!)
      resolved = true; setUncertain(false); command.current = null; setNotice("Rascunho salvo no servidor. Nenhuma nota foi transmitida.")
      if (!id) router.replace(`/fiscal/notas-saida/${value.data.id}`)
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (!resolved) setUncertain(true)
        setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação")
      }
    } finally { writing.current = false; setSaving(false) }
  }
  const editable = canEdit && !loading && !saving && !blocked && !uncertain
  const profileReady = readiness?.profileConfigured && !readiness.blockers.includes("company_and_fiscal_profile_inconsistent")
  let total = "Confira quantidades e preços"
  try { total = `R$ ${productsTotal(draft.items).replace(".", ",")}` } catch { /* Invalid fields remain visible until corrected. */ }
  return <main className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <Link className="text-sm text-primary underline" href="/fiscal/notas-saida" onClick={event => { if ((dirty || uncertain || saving) && !window.confirm("Sair sem confirmar esta edição?")) event.preventDefault() }}>Voltar aos rascunhos</Link>
    <header><p className="text-sm text-primary">Fiscal / NF-e de saída</p><h1 className="mt-2 text-3xl font-semibold">{id ? "Rascunho de NF-e" : "Preparar nota de saída"}</h1><p className="mt-3 text-muted-foreground">Homologação · Modelo 55 · Sem autorização fiscal</p>{snapshot && <p className="mt-2 break-all text-xs text-muted-foreground">{snapshot.data.id} · Revisão {snapshot.data.revision} · Emitente: {snapshot.data.issuer.legalName}</p>}</header>
    <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">Salve os dados para conferência. Rascunhos não geram numeração, XML, DANFE ou transmissão. CST, CSOSN, CFOP e enquadramento devem seguir a instrução do responsável fiscal.</p>
    {draft.sourceOrderId && <section className="rounded-xl border border-primary/30 p-4 text-sm"><p>Origem: <Link className="break-all text-primary underline" href={`/vendas/pedidos/${draft.sourceOrderId}`}>Pedido {draft.sourceOrderId}</Link>{preparation ? ` · Revisão consultada ${preparation.orderRevision}` : ""}</p>{preparation && <Link className="mt-2 inline-block text-primary underline" href={`/cadastros/clientes-fornecedores/${preparation.customerId}`}>Abrir cadastro do cliente</Link>}<p className="mt-2 text-muted-foreground">Esta preparação representa o pedido integral. Código, unidade, quantidade e preço permanecem os registrados na venda. Confira o endereço e informe o código IBGE e a tributação. Salvar não marca o pedido como faturado.</p></section>}
    {loading && <p role="status">Carregando dados fiscais…</p>}
    {readiness && !profileReady && <p role="alert" className="rounded-xl border p-4 text-sm">Preencha ou corrija a <Link className="text-primary underline" href="/preferencias/fiscal" target="_blank" rel="noopener noreferrer">configuração fiscal do emitente</Link> antes de salvar. Depois, recarregue os dados.</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}{blocked && " Sua edição foi preservada. Confira os dados atuais antes de tentar novamente."}</p>}
    {notice && <p role="status" className="rounded-xl border border-primary/30 p-4 text-sm">{notice}</p>}
    {!loading && <>
      {!canEdit && !error && <p className="text-sm">Seu acesso permite somente consultar este rascunho.</p>}
      <form onSubmit={event => void save(event)} className="space-y-6">
        <fieldset disabled={!editable} className="space-y-6 disabled:opacity-75">
          <section className="form-section grid gap-4 sm:grid-cols-2" aria-label="Operação fiscal">
            <Field label="Natureza da operação"><Input required maxLength={60} value={draft.operationNature} onChange={event => setDraft({ ...draft, operationNature: event.target.value })} /></Field>
            <Field label="Referência da instrução fiscal"><Input required maxLength={200} value={draft.taxRuleReference} onChange={event => setDraft({ ...draft, taxRuleReference: event.target.value })} /></Field>
          </section>
          <section className="form-section space-y-4" aria-label="Destinatário"><h2 className="text-lg font-semibold">Destinatário</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([['taxId', 'CPF/CNPJ', 14], ['legalName', 'Nome ou razão social', 60], ['municipalityCode', 'Código IBGE do município', 7], ['postalCode', 'CEP', 8], ['street', 'Logradouro', 60], ['number', 'Número', 60], ['district', 'Bairro', 60]] as const).map(([key, label, maximum]) => <Field key={key} label={label}><Input required readOnly={!!draft.sourceOrderId && key === "taxId"} maxLength={maximum} value={draft.recipient[key]} onChange={event => setDraft({ ...draft, recipient: { ...draft.recipient, [key]: event.target.value } })} /></Field>)}
            <Field label="UF do destinatário"><select required className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={draft.recipient.state} onChange={event => setDraft({ ...draft, recipient: { ...draft.recipient, state: event.target.value } })}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></Field>
          </div><p className="text-xs text-muted-foreground">Informe CPF/CNPJ, CEP e código IBGE somente com dígitos. O código IBGE deve corresponder à UF.</p></section>
          <section className="form-section space-y-4" aria-label="Itens do rascunho"><h2 className="text-lg font-semibold">Itens</h2>
            {canSearch && !draft.sourceOrderId && <div className="rounded-xl border p-4"><div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Buscar produto por nome ou SKU<Input value={query} onChange={event => setQuery(event.target.value)} /></label><Button type="button" variant="outline" disabled={searching || !query.trim()} onClick={() => void findProducts()}>{searching ? "Buscando…" : "Buscar produtos"}</Button></div>{productError && <p role="alert" className="mt-3 text-sm text-destructive">{productError}</p>}<ul className="mt-3 space-y-2">{products.map(product => <li key={product.id}><Button type="button" variant="outline" className="h-auto max-w-full whitespace-normal text-left" disabled={draft.items.length >= 990} onClick={() => addProduct(product)}>Adicionar {product.sku} — {product.name}</Button></li>)}</ul></div>}
            {draft.items.map((item, index) => <section key={index} className="space-y-4 rounded-xl border p-4" aria-label={`Item ${index + 1}`}>
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Item {index + 1}</h3><Button type="button" variant="outline" disabled={!!draft.sourceOrderId || draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, position) => position !== index) })}>Remover item {index + 1}</Button></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {([['code', 'Código do produto', 60], ['description', 'Descrição do produto', 120], ['unit', 'Unidade', 6], ['ncm', 'NCM', 8], ['cfop', 'CFOP', 4], ['quantity', 'Quantidade', 16], ['unitPrice', 'Preço unitário', 22], ['pisCst', 'CST do PIS', 2], ['cofinsCst', 'CST da COFINS', 2]] as const).map(([key, label, maximum]) => <Field key={key} label={label}><Input required readOnly={!!draft.sourceOrderId && ['code', 'unit', 'quantity', 'unitPrice'].includes(key)} maxLength={maximum} inputMode={['quantity', 'unitPrice'].includes(key) ? 'decimal' : 'text'} value={item[key]} onChange={event => changeItem(index, { [key]: event.target.value })} /></Field>)}
                <Field label="Origem da mercadoria"><select required className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={item.origin < 0 ? "" : item.origin} onChange={event => changeItem(index, { origin: event.target.value === "" ? -1 : Number(event.target.value) })}><option value="">Selecione conforme a instrução fiscal</option>{[0,1,2,3,4,5,6,7,8].map(origin => <option key={origin} value={origin}>{origin}</option>)}</select></Field>
                <Field label="CST do ICMS"><Input maxLength={2} value={item.icmsCst || ""} onChange={event => changeItem(index, { icmsCst: event.target.value || null })} /></Field>
                <Field label="CSOSN"><Input maxLength={3} value={item.csosn || ""} onChange={event => changeItem(index, { csosn: event.target.value || null })} /></Field>
              </div><p className="text-xs text-muted-foreground">Informe CST ou CSOSN de acordo com o CRT, sem preencher ambos. Quantidade aceita até 4 casas; preço, até 10. Não há cálculo de impostos.</p><p className="text-sm font-medium">Total bruto do item: {(() => { try { return `R$ ${itemTotal(item.quantity, item.unitPrice).replace(".", ",")}` } catch { return "Confira quantidade e preço" } })()}</p>
            </section>)}
            <Button type="button" variant="outline" disabled={!!draft.sourceOrderId || draft.items.length >= 990} onClick={() => setDraft({ ...draft, items: [...draft.items, blankItem()] })}>Adicionar item manualmente</Button>
          </section>
        </fieldset>
        <section className="form-section space-y-4"><p className="font-medium">Total bruto dos produtos: {total}</p><p className="text-sm text-muted-foreground">Frete, descontos e tributos não compõem este rascunho. O valor acima não representa o total fiscal final da NF-e.</p><div className="flex flex-wrap gap-3">{canEdit && <Button type="submit" disabled={loading || saving || blocked || !profileReady || !!id && (!etag || uncertain) || !uncertain && !dirty}>{saving ? "Confirmando gravação…" : uncertain && !id ? "Confirmar mesma solicitação" : "Salvar rascunho"}</Button>}<Button type="button" variant="outline" disabled={saving || loading} onClick={refresh}>Recarregar dados do servidor</Button></div>{uncertain && <p role="alert" className="text-sm">A gravação pode ter ocorrido. {id ? "Recarregue e confira a revisão antes de editar novamente." : "Confirme a mesma solicitação para consultar o resultado sem criar duplicatas."}</p>}</section>
      </form>
    </>}
  </main>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-2 text-sm">{label}{children}</label>
}
