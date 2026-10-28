import { PurchaseAccess } from "@/features/purchasing/purchase-access"
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PurchaseAccess view="payables" params={params} /> }
