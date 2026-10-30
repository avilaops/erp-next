import { ExecuteProductionOrder } from "@/features/inventory/details-operations-production";

export default async function ExecuteProductionOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExecuteProductionOrder id={id} />;
}

export const metadata = { title: "Executar ordem de produção" }
