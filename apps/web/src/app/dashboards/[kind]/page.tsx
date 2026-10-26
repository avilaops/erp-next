import { DashboardDetail, type DashboardKind } from "@/features/dashboard/dashboard-detail"

const dashboardKinds: DashboardKind[] = ["vendas", "margem-pedidos", "produtos", "clientes", "curva-abc", "metas"]

export function generateStaticParams() {
  return dashboardKinds.map((kind) => ({ kind }))
}

export default async function DashboardPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const resolved = dashboardKinds.includes(kind as DashboardKind) ? kind as DashboardKind : "vendas"
  return <DashboardDetail kind={resolved} />
}
