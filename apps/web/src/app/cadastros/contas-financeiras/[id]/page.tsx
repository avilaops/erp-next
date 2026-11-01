import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="contas-financeiras" mode="view" params={params} />
}

export const metadata = { title: "Detalhes de conta financeira" }
