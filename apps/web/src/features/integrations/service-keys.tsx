"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type KeySummary = Schema<"ServiceKeySummary">
type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; keys: KeySummary[] }
const endpoint = "/api/erp/integrations/service-keys"

async function failure(response: Response) {
  const problem = await response.json().catch(() => null)
  return typeof problem?.title === "string" ? problem.title : "Não foi possível concluir a operação."
}

function timestamp(value: string | null | undefined) {
  if (!value) return "Nunca utilizada"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR")
}

export function ServiceKeys({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [name, setName] = useState("")
  const [key, setKey] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await erpFetch(endpoint, { cache: "no-store", signal: controller.signal })
        if (!response.ok) throw new Error(await failure(response))
        const result = await response.json() as { data: KeySummary[] }
        if (!Array.isArray(result.data)) throw new Error("Resposta de integração inválida.")
        if (!controller.signal.aborted) setState({ kind: "ready", keys: result.data.map(({ id, name, keyPrefix, createdAt, lastUsedAt, revokedAt }) => ({ id, name, keyPrefix, createdAt, lastUsedAt, revokedAt })) })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ kind: "error", message: cause instanceof Error ? cause.message : "Serviço indisponível." })
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt, tenantId])

  function refresh() { setState({ kind: "loading" }); setAttempt((value) => value + 1) }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || key) return
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await erpFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify({ name: name.trim() }), cache: "no-store" })
      if (!response.ok) throw new Error(await failure(response))
      const created = await response.json() as { key: string }
      if (typeof created.key !== "string") throw new Error("Chave não recebida. Consulte a lista antes de criar outra.")
      if (!active.current) return
      setKey(created.key); setName(""); refresh()
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Não foi possível criar a chave. Consulte a lista antes de tentar novamente.")
    } finally { if (active.current) setBusy(false) }
  }

  async function revoke(item: KeySummary) {
    if (busy || !window.confirm(`Revogar a chave ${item.name}? O Lojas deixará de acessar o ERP com esta chave.`)) return
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await erpFetch(`${endpoint}/${item.id}`, { method: "DELETE", headers: { "X-Tenant-Id": tenantId }, cache: "no-store" })
      if (!response.ok) throw new Error(await failure(response))
      if (active.current) refresh()
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Não foi possível revogar a chave.")
    } finally { if (active.current) setBusy(false) }
  }

  async function copy() {
    if (!key) return
    try { await navigator.clipboard.writeText(key); if (active.current) setMessage("Chave copiada.") }
    catch { if (active.current) setMessage("Selecione a chave e copie manualmente.") }
  }

  return <div className="mt-6 min-w-0 space-y-5">
    {key && <section className="min-w-0 space-y-3 rounded-xl border border-primary p-4">
      <p role="status">Chave criada. Copie agora: ela não poderá ser consultada novamente.</p>
      <Input aria-label="Chave de serviço criada" readOnly value={key} autoComplete="off" className="font-mono" />
      <div className="flex flex-wrap gap-2"><Button onClick={() => void copy()}>Copiar chave</Button><Button variant="outline" onClick={() => { setKey(null); setMessage("") }}>Já salvei a chave</Button></div>
    </section>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {state.kind === "loading" ? <p role="status">Carregando chaves…</p> : state.kind === "error" ? <section className="space-y-3"><p role="alert">{state.message}</p><Button variant="outline" onClick={refresh}>Tentar novamente</Button></section> : <>
      <form onSubmit={(event) => void create(event)} className="space-y-3 rounded-xl border border-border p-4">
        <label className="grid gap-2 text-sm font-medium">Nome da chave<Input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={100} required autoComplete="off" disabled={busy || Boolean(key)} /></label>
        <Button type="submit" disabled={busy || Boolean(key)}>Criar chave</Button>
        <p className="text-sm text-muted-foreground">Guarde a chave no serviço que acessará o ERP. Se perder o valor, revogue e crie outra.</p>
      </form>
      <section aria-label="Chaves de serviço" className="space-y-3">
        {state.keys.length === 0 && <p>Nenhuma chave cadastrada.</p>}
        {state.keys.map((item) => <article key={item.id} className="min-w-0 space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-words font-semibold">{item.name}</h2><span className="text-sm">{item.revokedAt ? "Revogada" : "Ativa"}</span></div>
          <p className="break-all font-mono text-xs text-muted-foreground">{item.keyPrefix}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Criada em</dt><dd>{timestamp(item.createdAt)}</dd></div><div><dt className="text-muted-foreground">Última utilização</dt><dd>{timestamp(item.lastUsedAt)}</dd></div></dl>
          {!item.revokedAt && <Button variant="outline" disabled={busy} aria-label={`Revogar chave ${item.name}`} onClick={() => void revoke(item)}>Revogar chave</Button>}
        </article>)}
      </section>
    </>}
  </div>
}
