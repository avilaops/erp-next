import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { PageHeader } from "@/components/page-header"
import { PointOfSale } from "./point-of-sale"
import { CashClosing } from "./cash-closing"
import { CashHistory } from "./cash-history"

export async function PosAccess({ view }: { view: "sale" | "closing" | "history" }) {
  const access = await currentWorkspaceAccess()
  const title = view === "sale" ? "PDV" : view === "closing" ? "Fechamento do PDV" : "Histórico do PDV"
  const description = view === "sale" ? "Registre produtos e recebimentos no caixa da empresa ativa." : view === "closing" ? "Confira os recebimentos, o dinheiro contado e as movimentações do caixa." : "Consulte os caixas, fechamentos e comprovantes das vendas."
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 pb-12 pt-6 text-sm [--workspace-control-height:2.25rem] sm:px-6"><PageHeader eyebrow="Vendas" title={title} description={description} />{access.session ? view === "sale" ? <PointOfSale key={access.session.tenantId} /> : view === "closing" ? <CashClosing key={access.session.tenantId} /> : <CashHistory key={access.session.tenantId} /> : <WorkspaceAccessNotice state={access.state} />}</main>
}
