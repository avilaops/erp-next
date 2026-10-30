import { Suspense } from "react"
import { CheckoutDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "PV-1048" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutDetail id={id} />;
}

export const metadata = { title: "Expedição do pedido" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
