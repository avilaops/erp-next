"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Megaphone,
  Paperclip,
  Send,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function AssistantPage() {
  const [messages, setMessages] = useState([
    { from: "assistant", text: "Posso ajudar a localizar telas e resumir os dados demonstrativos deste ERP." },
  ])
  const [draft, setDraft] = useState("")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    setMessages((current) => [
      ...current,
      { from: "user", text: value },
      { from: "assistant", text: "Resposta demonstrativa: nenhum dado foi consultado, alterado ou enviado para um serviço de IA." },
    ])
    setDraft("")
  }

  return (
    <ExperienceShell
      eyebrow="Central de trabalho"
      title="Assistente do ERP"
      description="Conversa local para validar a experiência antes da integração com um provedor de IA."
    >
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground">
        Demonstração local. Mensagens e anexos não são persistidos nem transmitidos.
      </div>
      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="min-h-80 space-y-3 p-5" aria-live="polite">
          {messages.map((message, index) => (
            <div
              className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${message.from === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}
              key={`${message.from}-${index}`}
            >
              {message.text}
            </div>
          ))}
        </div>
        <form className="flex gap-2 border-t border-border p-4" onSubmit={submit}>
          <Button aria-label="Anexos indisponíveis na demonstração" disabled type="button" variant="outline">
            <Paperclip />
          </Button>
          <Input
            aria-label="Mensagem para o assistente"
            placeholder="Pergunte sobre uma área do ERP"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button disabled={!draft.trim()} type="submit">
            <Send /> Enviar
          </Button>
        </form>
      </section>
    </ExperienceShell>
  )
}

export function NewsPage() {
  const [active, setActive] = useState("Produto")
  const news = [
    ["Produto", "Nova central de trabalho", "Menus, dashboard e atalhos reunidos em uma experiência consistente."],
    ["Fiscal", "Eventos fiscais na página inicial", "Acompanhe avisos demonstrativos por prioridade e situação de leitura."],
    ["Operação", "Fluxos frontend concluídos", "Vendas, estoque, serviços e financeiro agora possuem operações locais navegáveis."],
  ] as const
  return (
    <ExperienceShell eyebrow="Produto" title="Novidades" description="Comunicados e banners administrativos da versão demonstrativa.">
      <div className="flex flex-wrap gap-2" aria-label="Filtrar novidades">
        {["Produto", "Fiscal", "Operação"].map((item) => (
          <Button key={item} onClick={() => setActive(item)} variant={active === item ? "default" : "outline"}>{item}</Button>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {news.filter(([category]) => category === active).map(([category, title, text]) => (
          <article className="rounded-2xl border border-border bg-card p-5" key={title}>
            <Megaphone className="size-5 text-primary" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary">{category}</p>
            <h2 className="mt-2 text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            <Button className="mt-5" variant="outline" onClick={() => undefined}>Ler comunicado</Button>
          </article>
        ))}
      </div>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Versão do frontend</h2>
        <p className="mt-2 text-sm text-muted-foreground">Roadmap FE-001 a FE-913 · dados locais · sem publicação automática.</p>
      </section>
    </ExperienceShell>
  )
}


function ExperienceShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/"><ArrowLeft className="size-4" />Início</Link>
      <header className="mb-7 mt-6 border-b border-border pb-7">
        <p className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="size-4" />{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  )
}
