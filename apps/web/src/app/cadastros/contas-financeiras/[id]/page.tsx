import { FinancialRecordDetail } from "@/features/record-details/financial-record";
export default async function FinancialAccountDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordDetail kind="accounts" recordId={id} />;
}
