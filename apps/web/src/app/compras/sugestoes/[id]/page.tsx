import { PurchaseSuggestionDetail } from "@/features/purchasing/details-suggestion";
export function generateStaticParams() {
  return [{ id: "sug-00118" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseSuggestionDetail id={id} />;
}
