import { ReferenceAccess } from "@/features/records/reference/reference-access"
export const metadata = { title: "Depósitos de estoque" }
export default function Page() {
  return <ReferenceAccess kind="depositos" mode="create" />
}
