import { FinancialRecordForm } from "@/features/record-details/financial-record";
export default async function EditFinancialAccountPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordForm kind="accounts" recordId={id} />;
}
