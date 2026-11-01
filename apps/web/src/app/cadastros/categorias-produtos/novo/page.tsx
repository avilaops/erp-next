import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="categorias-produtos" mode="create" />
}

export const metadata = { title: "Nova categoria de produtos" }
