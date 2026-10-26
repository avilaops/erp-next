import { InventoryDetail } from "@/features/inventory/details-operations-inventory";

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InventoryDetail id={id} />;
}
