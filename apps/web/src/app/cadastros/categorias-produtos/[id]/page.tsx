import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="categorias-produtos" mode="view" params={params} />
}
