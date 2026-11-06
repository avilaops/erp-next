import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export function CatalogFormSkeleton() {
  return <div role="status" aria-label="Carregando cadastro" className="space-y-6">
    <span className="sr-only">Carregando cadastro…</span>
    <div aria-hidden="true" className="space-y-6">
      <Skeleton className="h-5 w-40" />
      <div className="grid gap-6 sm:grid-cols-[160px_1fr]">
        <Skeleton className="h-40 w-40" />
        <div className="grid gap-5 sm:grid-cols-2">{Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>)}</div>
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  </div>
}

export function CatalogEditorLoading({ title = "Editar produto" }: { title?: string }) {
  return <div className="erp-editor"><PageHeader back={{ href: "/cadastros/produtos", label: "Voltar ao catálogo" }} breadcrumbs={[{ label: "Cadastros", href: "/cadastros" }, { label: "Produtos", href: "/cadastros/produtos" }, { label: title }]} eyebrow="Cadastros · Produtos" title={title} description="Preço base e classificação declarada. Condições negociadas e cálculo fiscal pertencem aos respectivos fluxos." /><section className="form-section"><CatalogFormSkeleton /></section></div>
}
