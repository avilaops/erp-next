import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="formas-pagamento" mode="edit" params={params} />
}

export const metadata = { title: "Editar forma de pagamento" }
