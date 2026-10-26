import { SalesOrderDetail } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "pv-1048" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SalesOrderDetail id={(await params).id} />;
}
