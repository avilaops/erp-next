import { CommercialSimulator } from "@/features/sales/commercial-simulator"
import { Suspense } from "react"
export const metadata = { title: "Simulador comercial" }
type PageProps = { searchParams: Promise<{ linha?: string; produto?: string; oportunidade?: string }> }
export default function Page(props: PageProps) {
  return <Suspense fallback={<p role="status">Carregando simulador…</p>}><SimulatorAccess {...props} /></Suspense>
}
async function SimulatorAccess({ searchParams }: PageProps) {
  const params = await searchParams
  return <CommercialSimulator initialLine={params.linha === "national" ? "national" : "imported"} initialProduct={typeof params.produto === "string" ? params.produto : ""} initialOpportunity={typeof params.oportunidade === "string" ? params.oportunidade : undefined} />
}
