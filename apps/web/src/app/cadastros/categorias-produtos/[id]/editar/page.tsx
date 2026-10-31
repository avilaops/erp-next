import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="categorias-produtos" mode="edit" params={params} />
}

export const metadata = { title: "Editar categoria de produtos" }
