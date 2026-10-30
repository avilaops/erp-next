import { Suspense } from "react"
import { WarehouseDetail } from "@/features/inventory/details-movements-forms";
async function ResolvedWarehouseDetailPage({
  params,
}: PageProps<"/estoque/depositos/[id]">) {
  const { id } = await params;
  return <WarehouseDetail warehouseId={id} />;
}

export const metadata = { title: "Detalhes de depósito" }

export default function WarehouseDetailPage(props: Parameters<typeof ResolvedWarehouseDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedWarehouseDetailPage {...props} /></Suspense>
}
