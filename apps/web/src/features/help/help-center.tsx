"use client"

import { useState } from "react"
import { BookOpen, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { helpTopics } from "@/content/help"

export function HelpCenter() {
  const [query, setQuery] = useState("")
  const normalized = query.toLocaleLowerCase("pt-BR").trim()
  const topics = helpTopics.filter(topic => `${topic.title} ${topic.summary} ${topic.keywords}`.toLocaleLowerCase("pt-BR").includes(normalized))
  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <header className="mb-7 border-b pb-7">
      <p className="text-sm font-medium text-primary">Suporte</p>
      <h1 className="mt-2 text-3xl font-semibold">Central de ajuda</h1>
      <p className="mt-3 text-muted-foreground">Orientações sobre os fluxos disponíveis e os limites atuais de cada área.</p>
    </header>
    <label className="relative block max-w-2xl">
      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
      <span className="sr-only">Buscar na ajuda</span>
      <Input className="min-h-11 pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Como podemos ajudar?" />
    </label>
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      {topics.map(({ id, title, summary, Content }) => <article key={id} className="min-w-0 rounded-2xl border bg-card p-5">
        <BookOpen className="size-5 text-primary" />
        <h2 className="mt-4 font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
        <details className="mt-4 rounded-lg border p-3">
          <summary className="cursor-pointer font-medium text-primary">Ver orientação<span className="sr-only"> sobre {title}</span></summary>
          <Content />
        </details>
      </article>)}
    </div>
    {!topics.length && <p role="status" className="mt-5">Nenhuma orientação encontrada. Tente outro termo.</p>}
    <p className="mt-6 text-sm text-muted-foreground">O atendimento externo será conectado em uma fase futura. Nenhuma solicitação é enviada agora.</p>
  </div>
}
