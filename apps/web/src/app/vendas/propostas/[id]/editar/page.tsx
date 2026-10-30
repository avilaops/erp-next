import { Suspense } from "react"
import { ProposalForm } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "pc-382" }]; }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalForm id={(await params).id} />;
}

export const metadata = { title: "Editar proposta" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
