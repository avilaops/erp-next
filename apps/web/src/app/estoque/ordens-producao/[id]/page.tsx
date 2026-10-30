import { ProductionOrderDetail } from "@/features/inventory/details-operations-production";

export default async function ProductionOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductionOrderDetail id={id} />;
}

export const metadata = { title: "Detalhes de ordem de produção" }
