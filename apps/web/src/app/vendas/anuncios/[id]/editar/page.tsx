import { AdForm } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "an-210" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <AdForm id={(await params).id} />;
}
