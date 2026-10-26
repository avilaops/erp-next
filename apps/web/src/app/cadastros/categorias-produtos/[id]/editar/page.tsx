import { CatalogRecordForm } from "@/features/record-details/catalogo-record-pages";

export default async function EditProductCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordForm kind="category" mode="edit" id={id} />;
}
