import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Tags" }
export default function Page( { params }: { params: Promise<{ id: string }> } ) {
  return <ReferenceAccess kind="tags" mode="edit" params={params} />
}
