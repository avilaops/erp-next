import { FinancialRecordForm } from "@/features/record-details/financial-record";
export default async function EditFinancialCategoryPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialRecordForm kind="categories" recordId={id} />;
}
