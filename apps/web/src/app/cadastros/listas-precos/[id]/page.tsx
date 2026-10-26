import { CatalogRecordDetail } from "@/features/record-details/catalogo-record-pages";

export default async function PriceListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordDetail kind="price-list" id={id} />;
}
