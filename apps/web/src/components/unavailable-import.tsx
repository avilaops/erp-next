import Link from "next/link"
import { PageHeader } from "./page-header"

export function UnavailableImport({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return <div className="mx-auto max-w-4xl px-4 py-8">
    <PageHeader eyebrow="Importação" title={title} description="O processamento de arquivos ainda não está disponível nesta tela." />
    <section className="form-section space-y-4">
      <h2 className="text-xl font-semibold">Importação indisponível</h2>
      <p>Nenhum arquivo é recebido, validado ou importado aqui. Não há resultados, totais de linhas ou relatório de processamento.</p>
      <Link className="inline-flex min-h-11 items-center font-medium text-primary underline" href={backHref}>{backLabel}</Link>
    </section>
  </div>
}
