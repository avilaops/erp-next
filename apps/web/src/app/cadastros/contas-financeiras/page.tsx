import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="contas-financeiras" mode="list" />
}

export const metadata = { title: "Contas financeiras" }
