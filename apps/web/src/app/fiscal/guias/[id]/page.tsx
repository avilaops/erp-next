import { TaxGuideDetail } from "@/features/fiscal/fiscal-details"

export function generateStaticParams() {
  return [{ id: "GUIA-091" }]
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TaxGuideDetail id={id} />
}

export const metadata = { title: "Detalhes da guia fiscal" }
