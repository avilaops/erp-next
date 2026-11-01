"use client"

import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"

import { AccessLink } from "@/components/session-recovery"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, LoaderCircle, Send, Sparkles, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Source = Schema<"AssistantSource">
type Message = { role: "user" | "assistant"; text: string; kind?: "model" | "erp"; sources?: Source[] }
type Event = Schema<"AssistantEvent">

const tools: Record<string, string> = {
  localizar_funcionalidade: "Localizando funcionalidades permitidas…",
  buscar_produtos: "Consultando produtos no ERP…",
  consultar_estoque: "Consultando saldos de estoque no ERP…",
  buscar_clientes: "Consultando clientes no ERP…",
  listar_pedidos: "Consultando pedidos recentes no ERP…",
  consultar_pedido: "Consultando o pedido no ERP…",
}

const statuses: Record<string, string> = { active: "Ativo", archived: "Arquivado", draft: "Rascunho", confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado" }

function internalLink(href: string) {
  return /^\/(?:cadastros\/(?:produtos|clientes-fornecedores)(?:\/[a-f0-9-]{36})?|estoque\/saldos|vendas\/pedidos(?:\/[a-f0-9-]{36})?|financeiro\/contas-(?:receber|pagar))$/i.test(href)
}

export function ErpAssistantModule() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [tenant, setTenant] = useState<{ id: string; legalName: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [retry, setRetry] = useState<string[] | null>(null)
  const controller = useRef<AbortController | null>(null)
  const active = useRef(false)
  const bottom = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    erpFetch("/api/erp/me", { cache: "no-store", signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? "Entre e selecione uma empresa para usar o assistente." : "Não foi possível validar seu acesso à empresa.")
      const value = await response.json()
      setTenant(value.tenant)
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao validar acesso.") })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => { abort.abort(); controller.current?.abort() }
  }, [])

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }) }, [messages, status])

  async function ask(questions: string[], isRetry = false) {
    if (!tenant || active.current) return
    active.current = true
    setBusy(true); setError(""); setRetry(null); setStatus("Preparando resposta…")
    const abort = new AbortController()
    controller.current = abort
    const answer: Message = { role: "assistant", text: "", sources: [] }
    setMessages(previous => isRetry
      ? [...previous.slice(0, -1), answer]
      : [...previous, { role: "user", text: questions.at(-1)! }, answer])
    const update = () => setMessages(previous => [...previous.slice(0, -1), { ...answer, sources: [...answer.sources!] }])
    let finished = false
    try {
      const response = await erpFetch("/api/erp/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant.id },
        body: JSON.stringify({ questions }), signal: abort.signal,
      })
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}))
        throw new Error(problem.title || "O assistente não pôde concluir a consulta.")
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error("Resposta do assistente indisponível.")
      const decoder = new TextDecoder()
      let pending = ""
      const consume = (line: string) => {
        if (!line.trim()) return
        const event = JSON.parse(line) as Event
        if (event.type === "error") throw new Error(event.title || "A consulta falhou.")
        if (event.type === "status") setStatus(event.text || "Preparando resposta…")
        if (event.type === "tool") setStatus(tools[event.name || ""] || "Consultando o ERP…")
        if (event.type === "source" && event.source) { answer.sources!.push(event.source); update() }
        if (event.type === "answer") { answer.text = event.text || ""; answer.kind = event.kind; update() }
        if (event.type === "done") finished = true
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          pending += decoder.decode(value, { stream: true })
          if (pending.length > 65_536) throw new Error("Resposta excedeu o limite.")
          const lines = pending.split("\n")
          pending = lines.pop() || ""
          lines.forEach(consume)
        }
        pending += decoder.decode()
        if (pending.trim()) consume(pending)
        if (!finished) throw new Error("A conexão foi interrompida antes da conclusão. Tente novamente.")
      } finally { await reader.cancel().catch(() => undefined) }
    } catch (reason) {
      setError(abort.signal.aborted ? "Geração interrompida. Você pode tentar novamente." : reason instanceof Error ? reason.message : "Falha ao consultar o assistente.")
      setRetry(questions)
    } finally {
      active.current = false; controller.current = null; setBusy(false); setStatus("")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || busy) return
    // Only questions travel as history. No client-supplied system/tool messages or prior ERP records.
    const questions = [...messages.filter(message => message.role === "user").map(message => message.text), question].slice(-6)
    while (new TextEncoder().encode(questions.join("")).length > 6000 && questions.length > 1) questions.shift()
    setDraft("")
    void ask(questions)
  }

  return <div className="mx-auto max-w-4xl px-4 pb-24 pt-8 lg:px-6">
    <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground" href="/"><ArrowLeft className="size-4" />Início</Link>
    <header className="mb-6 mt-6 border-b border-border pb-6">
      <p className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="size-4" />Central de trabalho</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Assistente do ERP</h1>
      <p className="mt-3 text-muted-foreground">Localize telas e consulte produtos, estoque, clientes e pedidos da empresa ativa.</p>
      {tenant && <p className="mt-2 text-sm font-medium text-primary">{tenant.legalName}</p>}
    </header>
    <p className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">Somente consultas. As fontes mostram dados confirmados pelo ERP conforme suas permissões. A conversa fica nesta tela e é processada na infraestrutura da Ávila Ops.</p>
    <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card" aria-label="Conversa com o assistente">
      <div className="max-h-[60vh] min-h-80 space-y-4 overflow-y-auto p-4 sm:p-5" role="log" aria-live="polite" aria-relevant="additions text">
        {!messages.length && <div className="rounded-2xl bg-muted p-4 text-sm">Posso localizar telas, buscar produtos e clientes, consultar estoque e mostrar os pedidos mais recentes. Para um pedido específico, informe o identificador exibido no cadastro.</div>}
        {messages.map((message, index) => <article key={index} className={`max-w-2xl rounded-2xl p-4 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
          <p className="mb-2 text-xs font-semibold">{message.role === "user" ? "Você" : message.kind === "model" ? "Resposta do modelo · confira as fontes" : "Assistente do ERP"}</p>
          <p className="whitespace-pre-wrap break-words">{message.text || (busy && index === messages.length - 1 ? status : "Resposta não concluída.")}</p>
          {message.sources?.map((source, sourceIndex) => <div key={sourceIndex} className="mt-3 rounded-xl border border-primary/20 bg-background p-3">
            <p className="font-semibold text-primary">Confirmado pelo ERP</p>
            <p className="mt-1 text-xs text-muted-foreground">Origem: {source.origin}</p>
            {source.scope && <p className="mt-2 text-xs text-muted-foreground">{source.scope}</p>}
            {!source.data.length && <p className="mt-2">Nenhum resultado encontrado para o termo informado.</p>}
            {source.data.map((record, recordIndex) => <div className="mt-3 border-t border-border pt-3" key={recordIndex}>
              {internalLink(record.href) ? <Link className="font-medium text-primary underline underline-offset-4" href={record.href}>{record.title}</Link> : <p>{record.title}</p>}
              {record.sku && <p className="mt-1">SKU: {record.sku} · Unidade: {record.unit}</p>}
              {record.basePrice !== undefined && <p>Preço base: R$ {record.basePrice.replace(".", ",")}</p>}
              {record.tradeName && <p className="mt-1 break-words">Nome fantasia: {record.tradeName}</p>}
              {record.customerName && <p className="mt-1 break-words">Cliente: {record.customerName}</p>}
              {record.amount !== undefined && <p>Valor do pedido: R$ {record.amount.replace(".", ",")}</p>}
              {record.dueDate && <p>Vencimento: {record.dueDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}</p>}
              {(source.tool === "buscar_clientes" || source.tool === "listar_pedidos" || source.tool === "consultar_pedido") && record.status && <p>Situação: {statuses[record.status] || record.status}</p>}
              {record.quantity !== undefined && <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{[["Saldo", record.quantity], ["Reservado", record.reserved], ["Disponível", record.available]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value} {record.unit}</dd></div>)}</dl>}
            </div>)}
            {source.total > source.data.length && <p className="mt-3 text-xs text-muted-foreground">Mostrando {source.data.length} de {source.total} resultados. {source.tool === "listar_pedidos" ? "Estes são os pedidos mais recentes. Abra a tela de pedidos para consultar os demais." : "Refine o termo da busca."}</p>}
          </div>)}
        </article>)}
        <div ref={bottom} />
      </div>
      {(busy || loading) && <p className="flex items-center gap-2 px-4 pb-3 text-sm text-primary" role="status"><LoaderCircle className="size-4 animate-spin" />{loading ? "Validando acesso à empresa…" : status}</p>}
      {error && <div className="mx-4 mb-4 rounded-xl border border-destructive/30 p-3 text-sm" role="alert"><p>{error}</p>{retry && <Button className="mt-2" variant="outline" disabled={busy} onClick={() => void ask(retry, true)}>Tentar novamente</Button>}{!tenant && !loading && <AccessLink className="mt-2 block text-primary underline" >Entrar no ERP</AccessLink>}</div>}
      <form className="flex flex-wrap gap-2 border-t border-border p-4" onSubmit={submit}>
        <Input className="min-w-0 flex-1 basis-40" aria-label="Mensagem para o assistente" placeholder="Pergunte sobre produtos, clientes ou pedidos" maxLength={1000} disabled={busy || !tenant} value={draft} onChange={event => setDraft(event.target.value)} />
        {busy ? <Button type="button" variant="outline" onClick={() => controller.current?.abort()}><Square className="size-4" />Interromper</Button> : <Button type="submit" disabled={!draft.trim() || !tenant}><Send className="size-4" />Enviar</Button>}
      </form>
    </section>
  </div>
}
