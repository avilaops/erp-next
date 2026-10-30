import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="formas-pagamento" mode="edit" params={params} />
}

export const metadata = { title: "Editar forma de pagamento" }
