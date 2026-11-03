import { Suspense } from "react"
import { ProposalsAccess } from "@/features/sales/proposals-access";

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalsAccess id={(await params).id} />;
}

export const metadata = { title: "Detalhes de proposta" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
