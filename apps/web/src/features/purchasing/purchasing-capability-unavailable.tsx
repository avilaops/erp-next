import Link from "next/link"
import { PageHeader } from "@/components/page-header"

export function PurchasingCapabilityUnavailable({
  title = "Sugestões de compras",
  description = "Necessidades calculadas a partir de estoque mínimo e demanda persistidos.",
  requirement = "Esta área não calcula sugestões porque ainda não há regras de estoque mínimo, demanda e fornecedores persistidas para a empresa ativa.",
  backHref = "/compras",
}: {
  title?: string
  description?: string
  requirement?: string
  backHref?: string
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-8 lg:px-6">
      <PageHeader eyebrow="Compras" title={title} description={description} />
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Capacidade indisponível</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {requirement} Nenhuma quantidade, valor ou situação estimada será inventada.
        </p>
        <Link className="mt-5 inline-flex min-h-11 items-center font-medium text-primary underline" href={backHref}>
          Voltar para Compras
        </Link>
      </section>
    </div>
  )
}
