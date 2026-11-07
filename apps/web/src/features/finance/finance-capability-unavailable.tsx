import Link from "next/link"
import { PageHeader } from "@/components/page-header"

export function FinanceCapabilityUnavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Financeiro" title={title} description={description} />
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Capacidade indisponível</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Esta área não está habilitada para operação porque ainda não há
          persistência, permissões e integração financeira de backend
          verificáveis. Nenhum valor demonstrativo será exibido e nenhuma ação
          local será apresentada como concluída.
        </p>
        <Link className="mt-5 inline-flex min-h-11 items-center font-medium text-primary underline" href="/financeiro">
          Voltar para Financeiro
        </Link>
      </section>
    </div>
  )
}
