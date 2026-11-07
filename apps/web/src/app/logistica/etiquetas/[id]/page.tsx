import { Suspense } from "react"
import { CapabilityUnavailable } from "@/features/logistics/logistics-screen";

export function generateStaticParams() {
  return [{ id: "FILA-331" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CapabilityUnavailable title={`Etiqueta ${id.toUpperCase()}`} />;
}

export const metadata = { title: "Detalhes da etiqueta" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
