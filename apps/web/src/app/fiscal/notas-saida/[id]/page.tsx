import { FiscalDocumentDetail } from "@/features/fiscal/fiscal-details"

export function generateStaticParams() {
  return [{ id: "NFE-000183" }]
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FiscalDocumentDetail id={id} kind="nfe" />
}
