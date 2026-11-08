import Link from "next/link"
import { PageHeader } from "@/components/page-header"

export function WorkspaceCapabilityUnavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Central de trabalho" title={title} description={description} />
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Capacidade indisponível</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Esta área ainda não possui fonte de dados, persistência e permissões
          de backend verificáveis. Nenhum conteúdo local será apresentado como
          informação operacional.
        </p>
        <Link className="mt-5 inline-flex min-h-11 items-center font-medium text-primary underline" href="/">
          Voltar para a visão geral
        </Link>
      </section>
    </div>
  )
}
