import { SecurityAudit } from "@/features/access/audit/security-audit"

export default function DeletedRecordsPage() {
  return <SecurityAudit mode="deletions" />
}

export const metadata = { title: "Consulta de exclusões realizadas" }
