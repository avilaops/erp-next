import { GuardedLink } from "@/components/shell/navigation-guard"
import { PageTitle } from "@/components/workspace/page-title"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"

type Breadcrumb = { label: string; href?: string }

export function PageHeader({ eyebrow, title, description, breadcrumbs, back, actions }: { eyebrow?: string; title: string; description?: string; breadcrumbs?: Breadcrumb[]; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="erp-page-header mb-8">
      {back && <GuardedLink href={back.href} className="erp-page-back"><ArrowLeft aria-hidden="true" className="size-4" />{back.label}</GuardedLink>}
      {breadcrumbs?.length ? <nav aria-label="Caminho de navegação" className="mb-2 text-sm font-medium text-primary">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {breadcrumbs.map((item, index) => <li key={`${item.label}:${index}`} className="flex min-w-0 items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="text-muted-foreground">/</span>}
            {item.href ? <GuardedLink className="break-words underline-offset-4 hover:underline" href={item.href} aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</GuardedLink> : <span className="break-words" aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>}
          </li>)}
        </ol>
      </nav> : eyebrow ? <p className="mb-2 text-sm font-medium text-primary">{eyebrow}</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-4"><PageTitle>{title}</PageTitle>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>
      {description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </header>
  )
}
