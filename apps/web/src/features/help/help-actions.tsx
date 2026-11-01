import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"

const destinations = {
  company: ["/preferencias/empresa/dados", "Dados da empresa"],
  access: ["/preferencias/usuarios", "Usuários e permissões"],
  sales: ["/vendas/pedidos", "Pedidos de venda"],
  newOrder: ["/vendas/pedidos/novo", "Novo pedido"],
  purchases: ["/compras/pedidos", "Pedidos de compra"],
  stock: ["/estoque/saldos", "Saldos e movimentos"],
  receivables: ["/financeiro/contas-receber", "Contas a receber"],
  payables: ["/financeiro/contas-pagar", "Contas a pagar"],
  fiscal: ["/fiscal", "Central fiscal"],
  monitor: ["/fiscal/monitor", "Monitor fiscal"],
  templates: ["/servicos/contratos/modelos", "Modelos de contratos"],
} as const

export function HelpAction({ action }: { action: keyof typeof destinations }) {
  const [href, label] = destinations[action]
  return <Link href={href} className={buttonVariants({ variant: "outline" })}>{label}</Link>
}
