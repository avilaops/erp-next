import { ReferenceAccess } from "@/features/reference-data/reference-access"

export default function Page() {
  return <ReferenceAccess kind="contas-financeiras" mode="create" />
}

export const metadata = { title: "Nova conta financeira" }
