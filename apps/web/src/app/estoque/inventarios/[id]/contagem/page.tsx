import { Suspense } from "react"
import { InventoryCountDetail } from "@/features/inventory/inventory-counts"

async function ResolvedInventoryCountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InventoryCountDetail id={id} />
}

export const metadata = { title: "Contagem de inventário" }

export default function InventoryCountPage(props: Parameters<typeof ResolvedInventoryCountPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedInventoryCountPage {...props} /></Suspense>
}
