import { Suspense } from "react"
import { InventoryCountDetail } from "@/features/inventory/inventory-counts"

async function ResolvedInventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InventoryCountDetail id={id} />
}

export const metadata = { title: "Detalhes de inventário" }

export default function InventoryDetailPage(props: Parameters<typeof ResolvedInventoryDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedInventoryDetailPage {...props} /></Suspense>
}
