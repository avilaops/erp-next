import { Suspense } from "react"
import { AdDetail } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "an-210" }]; }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  return <AdDetail id={(await params).id} />;
}

export const metadata = { title: "Detalhes de anúncio" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
