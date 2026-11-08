import { PurchasingCapabilityUnavailable } from "@/features/purchasing/purchasing-capability-unavailable"

export const metadata = { title: "Detalhes de nota de entrada" }

export default function Page() { return <PurchasingCapabilityUnavailable title="Detalhe de nota de entrada" description="Leitura e escrituração de nota fiscal de entrada persistida." requirement="Esta área ainda não possui integração de documento fiscal de entrada verificável." /> }
