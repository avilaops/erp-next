import { OpportunityEditor } from "@/features/sales/opportunities"
export const metadata = { title: "Oportunidade comercial" }
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <OpportunityEditor id={(await params).id} /> }
