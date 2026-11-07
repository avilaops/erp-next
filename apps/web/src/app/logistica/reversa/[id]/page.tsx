import { Suspense } from "react"
import { CapabilityUnavailable } from "@/features/logistics/logistics-screen";

export function generateStaticParams() {
  return [{ id: "REV-091" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CapabilityUnavailable title={`Logística reversa ${id.toUpperCase()}`} />;
}

export const metadata = { title: "Detalhes da logística reversa" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
