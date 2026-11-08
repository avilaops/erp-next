"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, Search } from "lucide-react"
import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import { isDemonstrationRoute } from "@/lib/demonstration-routes"
import { preferenceCategories } from "@/components/shell/preference-catalog"


function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim()
}

export function PreferencesOverview({ instruction = "Escolha uma das opções abaixo" }: { instruction?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const selectedId = useSearchParams().get("categoria") || "empresa"
  const search = normalize(query)
  const visibleCategories = preferenceCategories.map(category => ({
    ...category,
    sections: category.sections.map(section => ({
      ...section,
      items: section.items.filter(item => normalize(`${category.label} ${section.title} ${item.label} ${item.description || ""}`).includes(search)),
    })).filter(section => section.items.length),
  })).filter(category => category.sections.length)
  const selected = visibleCategories.find(category => category.id === selectedId) ?? visibleCategories[0]
  const categoryId = selected?.id

  useEffect(() => {
    if (!search || !categoryId || categoryId === selectedId) return
    const url = new URL(window.location.href)
    url.searchParams.set("categoria", categoryId)
    router.replace(`${url.pathname}${url.search}`, { scroll: false })
  }, [search, categoryId, selectedId, router])

  return (
    <>
      <div className="my-6 flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <h2 className="text-lg font-semibold">{instruction}</h2>
        <div className="flex min-w-0 items-center gap-2 sm:w-96">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Pesquisar nas preferências</span>
            <input type="search" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" placeholder="Pesquise aqui..." value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {query && <Button variant="outline" onClick={() => setQuery("")} aria-label="Limpar pesquisa">Limpar</Button>}
        </div>
      </div>
      {selected ? <>
        <p className="mb-4 text-sm text-muted-foreground">Preferências / {selected.label}</p>
          <section id="preference-options" aria-labelledby="preference-category-title" className="min-w-0">
            <h2 id="preference-category-title" className="mb-6 text-xl font-semibold">{selected.label}</h2>
            <div className="space-y-8">
              {selected.sections.map(section => <section key={section.title} aria-label={section.title}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{section.title}</h3>
                <ul className="divide-y divide-border border-y border-border">
                  {section.items.map(item => <li key={item.label}>
                    {item.href ? <Link href={item.href} className="flex min-h-12 items-start gap-2 py-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span>{item.label}</span>{item.description && <span className="mt-1 block text-xs font-normal text-muted-foreground">{item.description}</span>}</span>
                      {isDemonstrationRoute(item.href) && <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Indisponível</span>}
                    </Link> : <div aria-disabled="true" title={item.unavailable} className="flex min-h-12 items-start gap-2 py-3 text-sm text-muted-foreground">
                      <ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span>{item.label}</span><span className="sr-only">. {item.unavailable}</span></span>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">Indisponível</span>
                    </div>}
                  </li>)}
                </ul>
              </section>)}
            </div>
            {selected.sections.some(section => section.items.some(item => !item.href)) && <p className="mt-6 text-xs leading-5 text-muted-foreground">As opções marcadas como indisponíveis ainda não podem ser configuradas no ERP.</p>}
            {selected.sections.some(section => section.items.some(item => item.href && isDemonstrationRoute(item.href))) && <p className="mt-4 text-xs leading-5 text-muted-foreground">As opções marcadas como indisponíveis ainda não oferecem operações nesta empresa.</p>}
          </section>
      </> : <p role="status" className="py-8 text-sm text-muted-foreground">Nenhuma configuração encontrada.</p>}
    </>
  )
}
