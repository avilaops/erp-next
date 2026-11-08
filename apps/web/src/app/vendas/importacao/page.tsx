import { UnavailableImport } from "@/components/feedback/unavailable-import"
export default function Page() { return <UnavailableImport title="Importar pedidos" backHref="/vendas/pedidos" backLabel="Consultar pedidos" /> }

export const metadata = { title: "Importar pedidos" }
