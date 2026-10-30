import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page() {
  return <ReferenceAccess kind="contas-financeiras" mode="list" />
}

export const metadata = { title: "Contas financeiras" }
