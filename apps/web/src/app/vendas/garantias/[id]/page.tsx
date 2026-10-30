import { Suspense } from "react"
import { WarrantyDetail } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "gar-091" }]; }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  return <WarrantyDetail id={(await params).id} />;
}

export const metadata = { title: "Detalhes de garantia" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
