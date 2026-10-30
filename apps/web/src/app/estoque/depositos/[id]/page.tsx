import { WarehouseDetail } from "@/features/inventory/details-movements-forms";
export default async function WarehouseDetailPage({
  params,
}: PageProps<"/estoque/depositos/[id]">) {
  const { id } = await params;
  return <WarehouseDetail warehouseId={id} />;
}

export const metadata = { title: "Detalhes de depósito" }
