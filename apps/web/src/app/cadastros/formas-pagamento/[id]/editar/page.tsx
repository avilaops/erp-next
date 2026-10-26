import { FinancialRecordForm } from "@/features/record-details/financial-record";
export default async function EditPaymentMethodPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordForm kind="payments" recordId={id} />;
}
