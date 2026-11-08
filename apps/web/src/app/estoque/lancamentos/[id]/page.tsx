import { Suspense } from "react"
import { InventoryCapabilityUnavailable } from "@/features/inventory/inventory-capability-unavailable";
async function ResolvedMovementDetailPage({
  params,
}: PageProps<"/estoque/lancamentos/[id]">) {
  const { id } = await params;
  return <InventoryCapabilityUnavailable eyebrow="Estoque / Movimentações" title="Detalhe de lançamento" description={`O identificador ${id} não pode ser consultado por esta rota antiga.`} requirement="O histórico real de movimentos está disponível ao selecionar um produto no workspace de Estoque. Nenhum detalhe fictício será exibido por esta URL." />;
}

export const metadata = { title: "Detalhes de lançamento de estoque" }

export default function MovementDetailPage(props: Parameters<typeof ResolvedMovementDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedMovementDetailPage {...props} /></Suspense>
}
