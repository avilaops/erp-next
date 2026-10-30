import { MovementDetail } from "@/features/inventory/details-movements-forms";
export default async function MovementDetailPage({
  params,
}: PageProps<"/estoque/lancamentos/[id]">) {
  const { id } = await params;
  return <MovementDetail movementId={id} />;
}

export const metadata = { title: "Detalhes de lançamento de estoque" }
