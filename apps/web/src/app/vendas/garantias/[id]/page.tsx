import { WarrantyDetail } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "gar-091" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <WarrantyDetail id={(await params).id} />;
}
