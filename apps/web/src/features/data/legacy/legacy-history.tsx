"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { AccessLink } from "@/components/feedback/session-recovery"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"

type Snapshot = Schema<"LegacyPage">
const labels: Record<string, string> = {
  company_settings: "Empresa", customers: "Clientes", suppliers: "Fornecedores", products: "Produtos",
  product_lines: "Linhas de produtos", product_photos: "Fotos de produtos", supplier_items: "Catálogo de fornecedores",
  orders: "Pedidos e propostas", order_items: "Itens dos pedidos", order_closings: "Fechamentos",
  price_table_versions: "Versões das tabelas de preços", price_table_items: "Preços publicados",
  price_table_state_rates: "Alíquotas das tabelas", pricing_params: "Parâmetros de preços", state_tax_rates: "Alíquotas por estado",
  fiscal_invoices: "Notas fiscais emitidas", fiscal_invoice_events: "Eventos fiscais", fiscal_rules: "Regras fiscais",
  purchases: "Compras", purchase_items: "Itens das compras", payment_methods: "Formas de pagamento",
  payable_categories: "Categorias financeiras", equipment_colors: "Cores", pipeline_stages: "Etapas comerciais",
  production_stages: "Etapas de produção", opportunity_activities: "Atividades comerciais",
  name: "Nome", code: "Código", status: "Situação", number: "Número", quantity: "Quantidade",
  created_at: "Criado em", updated_at: "Atualizado em", document: "Documento", email: "E-mail",
  phone: "Telefone", discount: "Desconto", freight: "Frete", down_payment: "Entrada", notes: "Observações",
  table_price: "Preço de tabela", table_price_with_ipi: "Preço com IPI", environment: "Ambiente",
  access_key: "Chave de acesso", authorized_xml: "XML autorizado", issued_at: "Emitida em",
  invoice_total: "Total do fechamento", closed_at: "Fechado em", legal_name: "Razão social",
}
const label = (value: string) => labels[value] || value.replaceAll("_", " ")

export function LegacyHistory() {
  const [collection, setCollection] = useState("")
  const [offset, setOffset] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ offset: String(offset) })
    if (collection) params.set("collection", collection)
    erpFetch(`/api/erp/legacy-history?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.title || "Não foi possível consultar o histórico")
        setSnapshot(body); setError("")
      }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
    return () => controller.abort()
  }, [collection, offset])
  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <PageHeader eyebrow="Dados da empresa" title="Histórico do ERP anterior" description="Registros e arquivos originais preservados na migração. A consulta não altera pedidos nem repete operações financeiras ou fiscais." />
    <div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary underline" href="/cadastros/produtos">Cadastro atual de produtos</Link><AccessLink className="text-primary underline" >Entrar com Ávila Ops</AccessLink></div>
    {error && <p role="alert" className="form-section">{error}</p>}
    {!snapshot && !error && <p role="status">Carregando histórico…</p>}
    {snapshot && <>
      <label className="grid max-w-xl gap-2 font-medium">Tipo de registro<select className="rounded-lg border border-border bg-background p-3" value={collection} onChange={event => { setCollection(event.target.value); setOffset(0) }}><option value="">Todos os registros</option>{snapshot.collections.map(item => <option key={item.name} value={item.name}>{label(item.name)} ({item.count})</option>)}</select></label>
      <p className="text-sm text-muted-foreground">{snapshot.total} registros nesta consulta</p>
      <div className="space-y-3">{snapshot.data.map(row => <details className="form-section" key={row.id}><summary className="cursor-pointer font-medium">{label(row.collection)} · {row.title}</summary><dl className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(row.details && typeof row.details === "object" ? row.details : { conteúdo: row.details }).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label(key)}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value === null ? "Não informado" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}</dl>{row.files.length > 0 && <div className="mt-4 flex flex-wrap gap-4">{row.files.map(file => <a className="text-primary underline" key={file.id} href={`/api/erp/legacy-history/files/${file.id}`} download={file.filename}>{file.filename}</a>)}</div>}</details>)}</div>
      <div className="flex items-center gap-4"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</Button><span className="text-sm">Página {Math.floor(offset / 25) + 1}</span><Button variant="outline" disabled={offset + 25 >= snapshot.total} onClick={() => setOffset(offset + 25)}>Próxima</Button></div>
    </>}
  </div>
}
