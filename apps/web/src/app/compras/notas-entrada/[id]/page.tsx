import { EntryInvoiceDetail } from "@/features/purchasing/details-invoice";
export function generateStaticParams() {
  return [{ id: "000184322" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntryInvoiceDetail id={id} />;
}
