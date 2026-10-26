"use client"

import { useMemo, useState } from "react"
import { Building2, ChevronRight, CircleDollarSign, Percent, Search, Tags, WalletCards } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"

const groups = [
  { title: "Contas financeiras", description: "Bancos, caixas e contas operacionais", count: 3, status: "Ativo", icon: WalletCards },
  { title: "Categorias financeiras", description: "Classificação de receitas e despesas", count: 18, status: "Ativo", icon: Tags },
  { title: "Formas de pagamento", description: "Pix, boleto, cartão e transferência", count: 7, status: "Ativo", icon: CircleDollarSign },
  { title: "Condições de pagamento", description: "Prazos e parcelamentos comerciais", count: 5, status: "Revisar", icon: Building2 },
  { title: "Centros de custos", description: "Organização gerencial por área", count: 4, status: "Ativo", icon: Tags },
  { title: "Comissões", description: "Regras demonstrativas para vendedores", count: 0, status: "Não configurado", icon: Percent },
]

export function FinancialSettings() {
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => groups.filter((group) => `${group.title} ${group.description}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))), [query])
  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><PageHeader eyebrow="Preferências / Financeiro" title="Configurações financeiras" description="Estruture tabelas auxiliares sem criar saldos ou movimentações reais." /><label className="relative mb-8 block w-full lg:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Buscar configurações financeiras</span><Input className="h-10 pl-9" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar configurações" /></label></div>
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">Dados demonstrativos. Nenhum saldo, lançamento, comissão ou cobrança é calculado nesta interface.</div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Grupos financeiros">{filtered.length ? filtered.map((group) => { const Icon = group.icon; return <button className="settings-row w-full text-left disabled:cursor-not-allowed" type="button" disabled key={group.title} title="Disponível após contrato de backend"><span className="settings-symbol"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{group.title}</strong><small className="mt-1 block text-sm text-muted-foreground">{group.description}</small></span><span className="text-right"><strong className="block text-sm">{group.count}</strong><small className="text-xs text-muted-foreground">{group.status}</small></span><ChevronRight className="size-4 text-muted-foreground" /></button> }) : <div className="grid min-h-56 place-items-center p-6 text-center"><div><Search className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 font-semibold">Nenhuma configuração encontrada</h2><p className="mt-1 text-sm text-muted-foreground">Revise o termo pesquisado.</p></div></div>}</section>
    <p className="mt-4 text-xs text-muted-foreground">Ações destrutivas permanecem indisponíveis até existirem permissões, confirmação e auditoria no backend.</p>
  </div>
}
