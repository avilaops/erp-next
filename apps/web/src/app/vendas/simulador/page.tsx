import { CommercialSimulator } from "@/features/sales/commercial-simulator"
import { Suspense } from "react"
import { readCommercialItems, readCommercialTableQuery } from "@/features/sales/commercial-navigation-model"
export const metadata = { title: "Simulador comercial" }
type PageProps = { searchParams: Promise<{ linha?: string | string[]; produto?: string | string[]; oportunidade?: string | string[]; returnTo?: string | string[]; itens?: string | string[]; destinationState?: string | string[]; taxpayer?: string | string[] }> }
export default function Page(props: PageProps) {
  return <Suspense fallback={<p role="status">Carregando simulador…</p>}><SimulatorAccess {...props} /></Suspense>
}
async function SimulatorAccess({ searchParams }: PageProps) {
  const params = await searchParams
  const context = readCommercialTableQuery(new URLSearchParams({ destinationState: typeof params.destinationState === "string" ? params.destinationState : "", taxpayer: typeof params.taxpayer === "string" ? params.taxpayer : "" }))
  return <CommercialSimulator initialLine={params.linha === "national" ? "national" : "imported"} initialProduct={typeof params.produto === "string" ? params.produto : ""} initialItems={readCommercialItems(typeof params.itens === "string" ? params.itens : null)} initialDestination={context.destinationState} initialTaxpayer={context.taxpayer} initialOpportunity={typeof params.oportunidade === "string" ? params.oportunidade : undefined} returnTo={typeof params.returnTo === "string" ? params.returnTo : undefined} />
}
