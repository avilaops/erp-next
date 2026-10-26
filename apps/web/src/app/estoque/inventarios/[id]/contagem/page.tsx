import { InventoryCount } from "@/features/inventory/details-operations-inventory";

export default async function InventoryCountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InventoryCount id={id} />;
}
