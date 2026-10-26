import { ShippingDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "COT-1842" }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShippingDetail id={id} />;
}
