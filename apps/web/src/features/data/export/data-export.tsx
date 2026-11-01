import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"

export function DataExport() {
  return <div className="mx-auto max-w-4xl px-4 py-8">
    <PageHeader eyebrow="Preferências / Dados" title="Exportação de dados" description="A exportação por arquivo ainda não está disponível nesta tela." />
    <section className="form-section space-y-4">
      <h2 className="text-xl font-semibold">Exportação indisponível</h2>
      <p id="export-download-help">Downloads indisponíveis nesta demonstração. Nenhum arquivo foi gerado.</p>
      <p>Nenhuma solicitação é enviada e não há histórico de exportações executadas.</p>
      <Button disabled aria-describedby="export-download-help">Baixar</Button>
      <Link className="ml-4 inline-flex min-h-11 items-center text-primary underline" href="/preferencias?categoria=exportacao">Voltar às preferências</Link>
    </section>
  </div>
}
