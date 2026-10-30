import { Suspense } from "react"
import { EntryInvoiceDetail } from "@/features/purchasing/details-invoice";
export function generateStaticParams() {
  return [{ id: "000184322" }];
}
async function ResolvedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntryInvoiceDetail id={id} />;
}

export const metadata = { title: "Detalhes de nota de entrada" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
