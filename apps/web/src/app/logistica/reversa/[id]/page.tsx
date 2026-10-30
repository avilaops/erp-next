import { ReturnDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "REV-091" }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnDetail id={id} />;
}

export const metadata = { title: "Detalhes da logística reversa" }
