import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="formas-pagamento" mode="list" />
}

export const metadata = { title: "Formas de pagamento" }
