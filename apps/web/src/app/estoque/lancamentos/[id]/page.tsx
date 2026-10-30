import { Suspense } from "react"
import { MovementDetail } from "@/features/inventory/details-movements-forms";
async function ResolvedMovementDetailPage({
  params,
}: PageProps<"/estoque/lancamentos/[id]">) {
  const { id } = await params;
  return <MovementDetail movementId={id} />;
}

export const metadata = { title: "Detalhes de lançamento de estoque" }

export default function MovementDetailPage(props: Parameters<typeof ResolvedMovementDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedMovementDetailPage {...props} /></Suspense>
}
