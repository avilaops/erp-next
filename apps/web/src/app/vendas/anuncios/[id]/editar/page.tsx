import { Suspense } from "react"
import { AdForm } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "an-210" }]; }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  return <AdForm id={(await params).id} />;
}

export const metadata = { title: "Editar anúncio" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
