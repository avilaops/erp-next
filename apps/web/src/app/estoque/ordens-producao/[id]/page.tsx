import { Suspense } from "react"
import { ProductionWorkspace } from "@/features/production/production-workspace";

async function ResolvedProductionOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductionWorkspace id={id} />;
}

export const metadata = { title: "Detalhes de ordem de produção" }

export default function ProductionOrderDetailPage(props: Parameters<typeof ResolvedProductionOrderDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedProductionOrderDetailPage {...props} /></Suspense>
}
