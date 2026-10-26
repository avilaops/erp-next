import { SalesOrderEdit } from "@/features/sales/sales-details";

export function generateStaticParams() { return [{ id: "pv-1048" }]; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SalesOrderEdit id={(await params).id} />;
}
