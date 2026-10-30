import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="categorias-financeiras" mode="view" params={params} />
}

export const metadata = { title: "Detalhes de categoria financeira" }
