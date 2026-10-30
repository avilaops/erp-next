import { PurchaseAccess } from "@/features/purchasing/purchase-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PurchaseAccess view="receipt" params={params} /> }

export const metadata = { title: "Detalhes de recebimento de compra" }
