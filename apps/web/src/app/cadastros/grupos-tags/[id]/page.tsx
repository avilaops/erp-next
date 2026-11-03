import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Grupos de tags" }
export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="grupos-tags" mode="view" params={params} />
}
