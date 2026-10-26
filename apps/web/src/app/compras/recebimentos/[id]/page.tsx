import { ReceiptCheckIn } from "@/features/purchasing/details-receipt";
export function generateStaticParams() {
  return [{ id: "rec-00215" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiptCheckIn id={id} />;
}
