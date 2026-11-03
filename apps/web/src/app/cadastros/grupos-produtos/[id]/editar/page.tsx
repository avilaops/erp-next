import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Grupos de produtos" }
export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="grupos-produtos" mode="edit" params={params} />
}
