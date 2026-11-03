import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Tags" }
export default function Page() {
  return <ReferenceAccess kind="tags" mode="list" />
}
