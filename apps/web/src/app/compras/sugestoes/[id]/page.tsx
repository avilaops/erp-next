import { Suspense } from "react"
import { PurchaseSuggestionDetail } from "@/features/purchasing/details-suggestion";
export function generateStaticParams() {
  return [{ id: "sug-00118" }];
}
async function ResolvedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseSuggestionDetail id={id} />;
}

export const metadata = { title: "Detalhes de sugestão de compra" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
