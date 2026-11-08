import { PurchasingCapabilityUnavailable } from "@/features/purchasing/purchasing-capability-unavailable"

export const metadata = { title: "Detalhes de sugestão de compra" }

export default function Page() { return <PurchasingCapabilityUnavailable title="Detalhe de sugestão de compra" description="Detalhes de uma necessidade de reposição persistida." requirement="Esta área não possui sugestões persistidas para consulta." /> }
