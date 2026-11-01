import { CatalogRecordForm } from "@/features/records/details/catalogo-record-pages";

export default function NewPriceListPage() {
  return <CatalogRecordForm kind="price-list" mode="create" />;
}

export const metadata = { title: "Nova lista de preços" }
