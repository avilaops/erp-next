import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import type { Integration } from "./integration-data"

export function IntegrationDetail({ integration }: { integration: Integration }) {
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-5 px-4 py-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Integrações" title={integration.name} description="Consulte a disponibilidade desta integração." />
    <section className="form-section space-y-4">
      <h2 className="font-semibold">{integration.status === "operational" ? "Gerenciamento operacional disponível" : "Integração indisponível"}</h2>
      <p>{integration.reason}</p>
      {integration.href && <Link className="inline-block text-primary underline" href={integration.href}>Abrir gerenciamento</Link>}
    </section>
    <Link className="inline-block text-primary underline" href="/preferencias/integracoes">Voltar às integrações</Link>
  </div>
}
