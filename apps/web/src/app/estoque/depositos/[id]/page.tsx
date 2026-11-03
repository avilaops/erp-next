import { ReferenceAccess } from "@/features/records/reference/reference-access"
export const metadata = { title: "Depósitos de estoque" }
export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="depositos" mode="view" params={params} />
}
