import { Suspense } from "react"
import { ProductionOrderDetail } from "@/features/inventory/details-operations-production";

async function ResolvedProductionOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductionOrderDetail id={id} />;
}

export const metadata = { title: "Detalhes de ordem de produção" }

export default function ProductionOrderDetailPage(props: Parameters<typeof ResolvedProductionOrderDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedProductionOrderDetailPage {...props} /></Suspense>
}
