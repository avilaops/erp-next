import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="formas-pagamento" mode="view" params={params} />
}

export const metadata = { title: "Detalhes de forma de pagamento" }
