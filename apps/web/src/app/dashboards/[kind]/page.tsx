import { DashboardDetail, type DashboardKind } from "@/features/dashboard/dashboard-detail"
import { notFound } from "next/navigation"
import { Suspense } from "react"

const dashboardKinds: DashboardKind[] = ["vendas", "margem-pedidos", "produtos", "clientes", "curva-abc", "metas"]
const titles: Record<string, string> = { vendas: "Dashboard de vendas", "margem-pedidos": "Margem por pedido", produtos: "Dashboard de produtos", clientes: "Dashboard de clientes", "curva-abc": "Curva ABC", metas: "Metas" }

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  if (!Object.hasOwn(titles, kind)) notFound()
  return { title: titles[kind] }
}

export function generateStaticParams() {
  return dashboardKinds.map((kind) => ({ kind }))
}

type DashboardProps = { params: Promise<{ kind: string }> }

export default function DashboardPage({ params }: DashboardProps) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando dashboard…</p>}><ResolvedDashboard params={params} /></Suspense>
}

async function ResolvedDashboard({ params }: DashboardProps) {
  const { kind } = await params
  if (!dashboardKinds.includes(kind as DashboardKind)) notFound()
  return <DashboardDetail kind={kind as DashboardKind} />
}
