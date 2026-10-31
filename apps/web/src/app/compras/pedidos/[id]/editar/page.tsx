import { PurchaseAccess } from "@/features/purchasing/purchase-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PurchaseAccess view="edit" params={params} /> }

export const metadata = { title: "Editar pedido de compra" }
