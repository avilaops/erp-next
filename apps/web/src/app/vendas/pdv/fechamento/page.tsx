import { SalesCapabilityUnavailable } from "@/features/sales/sales-capability-unavailable"
export default function Page() { return <SalesCapabilityUnavailable title="Fechamento de caixa" description="Conferência e fechamento persistente do caixa do PDV." backHref="/vendas/pdv" /> }

export const metadata = { title: "Fechamento do PDV" }
