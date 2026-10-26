import { LabelDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "FILA-331" }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LabelDetail id={id} />;
}
