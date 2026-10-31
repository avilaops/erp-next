import { PurchaseAccess } from "@/features/purchasing/purchase-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PurchaseAccess view="detail" params={params} /> }

export const metadata = { title: "Detalhes de pedido de compra" }
