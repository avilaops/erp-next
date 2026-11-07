import { CommercialSimulator } from "@/features/sales/commercial-simulator"
export const metadata = { title: "Simulador comercial" }
export default async function Page({ searchParams }: { searchParams: Promise<{ linha?: string; produto?: string; oportunidade?: string }> }) {
  const params = await searchParams
  return <CommercialSimulator initialLine={params.linha === "national" ? "national" : "imported"} initialProduct={typeof params.produto === "string" ? params.produto : ""} initialOpportunity={typeof params.oportunidade === "string" ? params.oportunidade : undefined} />
}
