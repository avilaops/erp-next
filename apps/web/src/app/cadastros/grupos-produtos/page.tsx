import { ReferenceAccess } from "@/features/records/reference/reference-access"

export const metadata = { title: "Grupos de produtos" }
export default function Page() {
  return <ReferenceAccess kind="grupos-produtos" mode="list" />
}
