import { CatalogRecordForm } from "@/features/record-details/catalogo-record-pages";

export default async function EditPriceListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordForm kind="price-list" mode="edit" id={id} />;
}

export const metadata = { title: "Editar lista de preços" }
