import { AdDetail } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "an-210" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <AdDetail id={(await params).id} />;
}

export const metadata = { title: "Detalhes de anúncio" }
