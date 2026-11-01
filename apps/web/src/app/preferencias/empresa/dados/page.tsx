import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import { AccountShell } from "@/features/company/account/account-shell"

export default function CompanyDataPage() {
  return (
    <AccountShell>
      <Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace /></Suspense>
    </AccountShell>
  )
}

export const metadata = { title: "Alterar dados da empresa" }
