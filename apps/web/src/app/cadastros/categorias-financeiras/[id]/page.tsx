import { FinancialRecordDetail } from "@/features/record-details/financial-record";
export default async function FinancialCategoryDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordDetail kind="categories" recordId={id} />;
}
