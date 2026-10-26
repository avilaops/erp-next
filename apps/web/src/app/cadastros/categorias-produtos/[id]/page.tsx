import { CatalogRecordDetail } from "@/features/record-details/catalogo-record-pages";

export default async function ProductCategoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordDetail kind="category" id={id} />;
}
