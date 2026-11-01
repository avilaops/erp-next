import { ReferenceAccess } from "@/features/records/reference/reference-access"

export default function Page() {
  return <ReferenceAccess kind="categorias-produtos" mode="list" />
}

export const metadata = { title: "Categorias de produtos" }
