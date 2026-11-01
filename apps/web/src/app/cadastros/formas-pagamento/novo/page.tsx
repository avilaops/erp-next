import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="formas-pagamento" mode="create" />
}

export const metadata = { title: "Nova forma de pagamento" }
