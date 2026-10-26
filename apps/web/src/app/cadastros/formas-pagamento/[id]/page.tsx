import { FinancialRecordDetail } from "@/features/record-details/financial-record";
export default async function PaymentMethodDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordDetail kind="payments" recordId={id} />;
}
