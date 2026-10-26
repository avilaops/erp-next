import { PostingDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "OBJ-2481" }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostingDetail id={id} />;
}
