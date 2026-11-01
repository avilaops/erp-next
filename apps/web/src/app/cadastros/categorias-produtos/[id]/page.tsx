import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="categorias-produtos" mode="view" params={params} />
}

export const metadata = { title: "Detalhes de categoria de produtos" }
