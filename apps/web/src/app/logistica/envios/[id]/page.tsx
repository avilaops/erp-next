import { Suspense } from "react"
import { ShippingDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "COT-1842" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShippingDetail id={id} />;
}

export const metadata = { title: "Detalhes do envio" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
