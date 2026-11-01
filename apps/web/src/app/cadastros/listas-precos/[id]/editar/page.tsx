import { Suspense } from "react"
import { CatalogRecordForm } from "@/features/records/details/catalogo-record-pages";

async function ResolvedEditPriceListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordForm kind="price-list" mode="edit" id={id} />;
}

export const metadata = { title: "Editar lista de preços" }

export default function EditPriceListPage(props: Parameters<typeof ResolvedEditPriceListPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedEditPriceListPage {...props} /></Suspense>
}
