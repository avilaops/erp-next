import { Suspense } from "react"
import { LabelDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "FILA-331" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LabelDetail id={id} />;
}

export const metadata = { title: "Detalhes da etiqueta" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
