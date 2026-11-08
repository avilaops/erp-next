import { PurchaseAccess } from "@/features/purchasing/purchase-access"
import { PayrollOverview, StaffPayroll } from "@/features/staff/payroll-workspace"
import { PageHeader } from "@/components/page-header"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Suspense } from "react"

type Filters = { aba?: string; funcionario?: string }

export default function Page({ searchParams }: { searchParams: Promise<Filters> }) {
  return <Suspense fallback={<p role="status">Carregando contas a pagar…</p>}><PayablesView searchParams={searchParams} /></Suspense>
}

async function PayablesView({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams
  const payroll = filters.aba === "funcionarios"
  const employee = typeof filters.funcionario === "string" && /^[0-9a-f-]{36}$/i.test(filters.funcionario) ? filters.funcionario : null
  return <>
    <nav aria-label="Áreas de contas a pagar" className="mx-4 mb-4 flex flex-wrap gap-3 sm:mx-6">
      <Link href="/financeiro/contas-pagar" aria-current={!payroll ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Contas e pagamentos</Link>
      <Link href="/financeiro/contas-pagar?aba=funcionarios" aria-current={payroll ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Pagamentos de funcionários</Link>
    </nav>
    {!payroll ? <PurchaseAccess view="payables" /> : employee ? <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <PageHeader breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a pagar", href: "/financeiro/contas-pagar" }, { label: "Funcionário" }]} title="Pagamentos do funcionário" description="Salário, aprovações e histórico na área financeira da empresa." />
      <StaffPayroll id={employee} />
    </div> : <PayrollOverview />}
  </>
}

export const metadata = { title: "Contas a pagar" }
