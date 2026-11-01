import Link from "next/link"
import { Suspense } from "react"
import { connection } from "next/server"
import { PageHeader } from "@/components/page-header"
import { currentWorkspaceAccess, WorkspaceAccessNotice } from "@/features/access/workspace-access"
import { Payables } from "./payables"
import { PurchaseDetail, PurchaseReceipt } from "./purchase-detail"
import { PurchaseEditor } from "./purchase-editor"
import { PurchaseList } from "./purchase-list"
import { purchaseLink } from "./purchase-types"

type View = "overview" | "orders" | "create" | "detail" | "edit" | "receipts" | "receipt" | "payables"
type Props = { view: View; params?: Promise<{ id: string }> }
export function PurchaseAccess(props: Props) {
  return <Suspense fallback={<p role="status">Carregando acesso às compras…</p>}><AuthorizedPurchase {...props} /></Suspense>
}
async function AuthorizedPurchase({ view, params }: Props) {
  await connection()
  const access = await currentWorkspaceAccess()
  const id = params ? (await params).id : undefined
  return <div className="mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-24 pt-6 sm:px-6">
    {!access.session ? <><PageHeader eyebrow={view === "payables" ? "Financeiro" : "Compras"} title={view === "payables" ? "Contas a pagar" : "Compras"} description="Operações da empresa ativa." /><WorkspaceAccessNotice state={access.state} /></> : view === "overview" ? <>
      <PageHeader eyebrow="Compras" title="Compras e recebimentos" description="Do pedido ao recebimento dos produtos e à obrigação financeira." />
      <section className="form-section space-y-4"><Link className={`${purchaseLink} block`} href="/compras/pedidos">Pedidos de compra</Link><Link className={`${purchaseLink} block`} href="/compras/recebimentos">Recebimentos de compras</Link><Link className={`${purchaseLink} block`} href="/financeiro/contas-pagar">Contas a pagar</Link><p className="text-sm text-muted-foreground">A entrada física é registrada no recebimento. O pagamento é declarado no financeiro, sem transferência bancária.</p></section>
      <section className="form-section mt-5 space-y-3"><h2 className="font-semibold">Outras áreas de compras</h2><p>Consulte as notas de entrada. As sugestões de reposição permanecem demonstrativas.</p><Link className={`${purchaseLink} mr-4`} href="/compras/notas-entrada">Notas de entrada</Link><Link className={purchaseLink} href="/compras/sugestoes">Sugestões — demonstração</Link></section>
    </> : view === "payables" ? <Payables id={id} /> : view === "create" || view === "edit" ? <PurchaseEditor id={id} /> : view === "detail" && id ? <PurchaseDetail key={id} id={id} /> : view === "receipt" && id ? <PurchaseReceipt key={id} id={id} /> : <PurchaseList receiving={view === "receipts"} />}
  </div>
}
