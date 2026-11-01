import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="contas-financeiras" mode="edit" params={params} />
}

export const metadata = { title: "Editar conta financeira" }
