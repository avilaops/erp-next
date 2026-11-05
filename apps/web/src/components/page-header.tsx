import { GuardedLink } from "@/components/shell/navigation-guard"

type Breadcrumb = { label: string; href?: string }

export function PageHeader({ eyebrow, title, description, breadcrumbs }: { eyebrow: string; title: string; description: string; breadcrumbs?: Breadcrumb[] }) {
  return (
    <header className="mb-8">
      {breadcrumbs?.length ? <nav aria-label="Caminho de navegação" className="mb-2 text-sm font-medium text-primary">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {breadcrumbs.map((item, index) => <li key={`${item.label}:${index}`} className="flex min-w-0 items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="text-muted-foreground">/</span>}
            {item.href ? <GuardedLink className="break-words underline-offset-4 hover:underline" href={item.href}>{item.label}</GuardedLink> : <span className="break-words" aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>}
          </li>)}
        </ol>
      </nav> : <p className="mb-2 text-sm font-medium text-primary">{eyebrow}</p>}
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
    </header>
  )
}
