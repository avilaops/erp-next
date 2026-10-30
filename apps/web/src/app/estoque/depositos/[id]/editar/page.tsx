import { WarehouseForm } from "@/features/inventory/details-movements-forms";
export default async function EditWarehousePage({
  params,
}: PageProps<"/estoque/depositos/[id]/editar">) {
  const { id } = await params;
  return <WarehouseForm warehouseId={id} />;
}

export const metadata = { title: "Editar depósito" }
