import { Suspense } from "react"
import { ExecuteProductionOrder } from "@/features/inventory/details-operations-production";

async function ResolvedExecuteProductionOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExecuteProductionOrder id={id} />;
}

export const metadata = { title: "Executar ordem de produção" }

export default function ExecuteProductionOrderPage(props: Parameters<typeof ResolvedExecuteProductionOrderPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedExecuteProductionOrderPage {...props} /></Suspense>
}
