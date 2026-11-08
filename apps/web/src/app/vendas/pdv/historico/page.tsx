import { SalesCapabilityUnavailable } from "@/features/sales/sales-capability-unavailable"
export default function Page() { return <SalesCapabilityUnavailable title="Histórico do PDV" description="Consulta dos fechamentos persistidos do caixa do PDV." backHref="/vendas/pdv" /> }

export const metadata = { title: "Histórico do PDV" }
