import { CheckoutDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "PV-1048" }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutDetail id={id} />;
}
