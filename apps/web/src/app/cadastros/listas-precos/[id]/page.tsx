import { Suspense } from "react"
import { CatalogRecordDetail } from "@/features/records/details/catalogo-record-pages";

async function ResolvedPriceListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogRecordDetail kind="price-list" id={id} />;
}

export const metadata = { title: "Detalhes de lista de preços" }

export default function PriceListDetailPage(props: Parameters<typeof ResolvedPriceListDetailPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPriceListDetailPage {...props} /></Suspense>
}
