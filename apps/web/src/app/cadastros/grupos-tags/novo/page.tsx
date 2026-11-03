import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Grupos de tags" }
export default function Page() {
  return <ReferenceAccess kind="grupos-tags" mode="create" />
}
