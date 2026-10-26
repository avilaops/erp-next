import { PeopleRecord } from "@/features/record-details/pessoas-record";
export default async function Page({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PeopleRecord kind="funcionarios" mode="edit" recordId={id} />;
}
