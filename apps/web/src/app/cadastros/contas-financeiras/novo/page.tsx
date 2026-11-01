import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="contas-financeiras" mode="create" />
}

export const metadata = { title: "Nova conta financeira" }
