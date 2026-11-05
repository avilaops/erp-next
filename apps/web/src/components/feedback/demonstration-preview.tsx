"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { isDemonstrationRoute } from "@/lib/demonstration-routes"
import Link from "next/link"

const destinations = [
  ["Produtos", "/cadastros/produtos"],
  ["Clientes e fornecedores", "/cadastros/clientes-fornecedores"],
  ["Pedidos de venda", "/vendas/pedidos"],
  ["Pedidos de compra", "/compras/pedidos"],
  ["Estoque", "/estoque"],
  ["Contas a receber", "/financeiro/contas-receber"],
  ["Contas a pagar", "/financeiro/contas-pagar"],
  ["Contratos", "/servicos/contratos"],
] as const

export function DemonstrationPreview({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  if (!isDemonstrationRoute(pathname)) return <>{children}</>
  // Do not mount legacy preview components: their local state and example
  // records must never look like operations or data of the active company.
  const directory = ["/cadastros", "/servicos", "/logistica", "/relatorios"].includes(pathname)
  const title = ({ "/cadastros": "Cadastros", "/servicos": "Serviços", "/logistica": "Logística", "/relatorios": "Relatórios" } as Record<string, string>)[pathname]
  return <section className="mx-auto w-full min-w-0 max-w-5xl space-y-5 px-4 py-8 lg:px-6">
    <Link className="inline-block text-primary underline" href="/">Voltar à visão geral</Link>
    <h1 className="text-3xl font-semibold">{directory ? title : "Funcionalidade indisponível"}</h1>
    <p className="text-muted-foreground">{directory ? "Acesse os registros e operações da empresa." : "Esta funcionalidade ainda não está disponível. Consulte os registros da empresa nas operações abaixo."}</p>
    <nav aria-label="Operações disponíveis" className="grid gap-3 sm:grid-cols-2">{destinations.map(([label, href]) => <Link className="min-w-0 rounded-xl border bg-card p-4 font-medium text-primary hover:bg-accent" href={href} key={href}>{label}</Link>)}</nav>
  </section>
}
