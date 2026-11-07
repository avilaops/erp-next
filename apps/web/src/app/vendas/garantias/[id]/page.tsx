import { Suspense } from "react"
import { WarrantyDetail } from "@/features/sales/warranty-workspace";
import { WarrantyAssignment } from "@/features/sales/warranty-assignment";

export function generateStaticParams() { return [{ id: "gar-091" }]; }
async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  return <><WarrantyDetail id={id} /><div className="mx-auto w-full max-w-6xl px-4 pb-24"><WarrantyAssignment id={id} /></div></>;
}

export const metadata = { title: "Detalhes de garantia" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
