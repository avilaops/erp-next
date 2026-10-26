import { PurchaseOrderEdit } from "@/features/purchasing/details-order";
export function generateStaticParams() {
  return [{ id: "pc-00482" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseOrderEdit id={id} />;
}
