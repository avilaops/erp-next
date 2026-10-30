import { ProposalForm } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "pc-382" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalForm id={(await params).id} />;
}

export const metadata = { title: "Editar proposta" }
