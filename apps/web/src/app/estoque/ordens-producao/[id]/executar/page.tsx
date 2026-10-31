import { Suspense } from "react"
import { ProductionWorkspace } from "@/features/production/production-workspace";

async function ResolvedExecuteProductionOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductionWorkspace id={id} />;
}

export const metadata = { title: "Executar ordem de produção" }

export default function ExecuteProductionOrderPage(props: Parameters<typeof ResolvedExecuteProductionOrderPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedExecuteProductionOrderPage {...props} /></Suspense>
}
