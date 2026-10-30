import { Suspense } from "react"
import { WarehouseForm } from "@/features/inventory/details-movements-forms";
async function ResolvedEditWarehousePage({
  params,
}: PageProps<"/estoque/depositos/[id]/editar">) {
  const { id } = await params;
  return <WarehouseForm warehouseId={id} />;
}

export const metadata = { title: "Editar depósito" }

export default function EditWarehousePage(props: Parameters<typeof ResolvedEditWarehousePage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedEditWarehousePage {...props} /></Suspense>
}
