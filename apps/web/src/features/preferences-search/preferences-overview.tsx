"use client"

import { useState } from "react"
import { Building2, ChevronRight, Search, Settings2 } from "lucide-react"
import { GuardedLink as Link } from "@/components/navigation-guard"
import { preferenceGroups } from "@/components/navigation-catalog"
import { Button } from "@/components/ui/button"

const categories = preferenceGroups.flatMap(group => group.items.map(item => ({
  ...item,
  options: item.href === "/preferencias/empresa"
    ? [
      { label: "Geral", href: item.href, section: "Configurações da empresa" },
      { label: "Alterar dados da empresa", href: "/preferencias/empresa/dados", section: "Dados cadastrais" },
    ]
    : [{ label: item.label, href: item.href, section: "Configurações" }],
})))

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim()
}

export function PreferencesOverview() {
  const [query, setQuery] = useState("")
  const [selectedHref, setSelectedHref] = useState(categories[0].href)
  const search = normalize(query)
  const visibleCategories = categories.filter(category => normalize(`${category.label} ${category.options.map(option => option.label).join(" ")}`).includes(search))
  const selected = visibleCategories.find(category => category.href === selectedHref) ?? visibleCategories[0]

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-8 lg:px-6">
      <nav className="mb-4 flex items-center gap-2 text-sm text-muted-foreground" aria-label="Caminho de navegação">
        <Link href="/" className="hover:text-foreground">Início</Link>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span aria-current="page">Preferências</span>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Preferências</h1>
      <div className="my-6 flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <h2 className="text-lg font-semibold">Escolha uma das opções abaixo</h2>
        <div className="flex min-w-0 items-center gap-2 sm:w-96">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Pesquisar nas preferências</span>
            <input type="search" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" placeholder="Pesquise aqui..." value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {query && <Button variant="outline" onClick={() => setQuery("")} aria-label="Limpar pesquisa">Limpar</Button>}
        </div>
      </div>
      {selected ? (
        <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
          <nav className="overflow-hidden rounded-xl border border-border self-start" aria-label="Categorias de preferências">
            {visibleCategories.map(category => {
              const active = category.href === selected.href
              const Icon = category.href === "/preferencias/empresa" ? Building2 : Settings2
              return (
                <button key={category.href} type="button" aria-pressed={active} aria-controls="preference-options" onClick={() => setSelectedHref(category.href)}
                  className={`flex min-h-12 w-full items-center gap-3 border-b border-border px-4 py-3 text-left text-sm font-medium transition last:border-b-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? "bg-primary/10 text-primary" : "text-foreground"}`}>
                  <Icon className="size-5 shrink-0" aria-hidden="true" />{category.label}
                </button>
              )
            })}
          </nav>
          <section id="preference-options" aria-labelledby="preference-category-title" className="min-w-0">
            <h2 id="preference-category-title" className="mb-6 text-xl font-semibold">{selected.label}</h2>
            <div className="space-y-8">
              {selected.options.map(option => (
                <div key={option.href}>
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">{option.section}</h3>
                  <Link href={option.href} className="flex min-h-12 items-center gap-2 border-y border-border py-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className="size-4 shrink-0 text-primary" aria-hidden="true" />{option.label}
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : <p role="status" className="py-8 text-sm text-muted-foreground">Nenhuma configuração encontrada.</p>}
    </div>
  )
}
