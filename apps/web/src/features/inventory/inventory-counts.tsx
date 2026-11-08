"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ClipboardCheck, Plus, RefreshCw, ShieldAlert } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"

type Count = { id: string; status: "open" | "approved" | "cancelled"; reference: string; createdAt: string; lineCount: number; countedLines: number }
type CountLine = { productId: string; sku: string; name: string; unit: string; expectedQuantity: string; countedQuantity: string | null }
type CountDetail = { count: Count; lines: CountLine[] }
const labels = { open: "Aberto", approved: "Aprovado", cancelled: "Cancelado" }

async function read(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.title || "Operação indisponível"); return value }

export function InventoryCounts() {
  const [counts, setCounts] = useState<Count[]>([]); const [reference, setReference] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("")
  const load = useCallback(async () => { setLoading(true); setError(""); try { setCounts((await read(await erpFetch("/api/erp/inventory-counts?limit=100&offset=0", { cache: "no-store" }))).data || []) } catch (cause) { setError(cause instanceof Error ? cause.message : "Inventários indisponíveis") } finally { setLoading(false) } }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const router = useRouter()
  async function create() { if (reference.trim().length < 2) { setError("Informe uma referência para o inventário."); return } setBusy(true); setError(""); try { const created = await read(await erpFetch("/api/erp/inventory-counts", { method: "POST", body: JSON.stringify({ reference: reference.trim() }), headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } })); router.push(`/estoque/inventarios/${created.id}`) } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar o inventário") } finally { setBusy(false) } }
  return <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6"><div className="mb-4 flex flex-wrap justify-end gap-3">{<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw />Atualizar</Button>}</div><section className="mt-6 rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">Novo inventário</h2><div className="mt-4 flex flex-col gap-3 sm:flex-row"><Input value={reference} onChange={event => setReference(event.target.value)} placeholder="Ex.: Inventário loja 07/11/2026" maxLength={120} /><Button onClick={() => void create()} disabled={busy}><Plus />Criar sessão</Button></div></section>{error && <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><ShieldAlert className="mr-2 inline size-4" />{error}</p>}{loading ? <p className="mt-6" role="status">Carregando inventários…</p> : !counts.length ? <section className="mt-6 rounded-2xl border border-border bg-card p-6"><ClipboardCheck className="size-6 text-primary" /><h2 className="mt-3 font-semibold">Nenhum inventário criado</h2><p className="mt-1 text-sm text-muted-foreground">A primeira sessão começa com o saldo atual dos produtos ativos.</p></section> : <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="divide-y divide-border">{counts.map(count => <Link className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-muted/30" href={`/estoque/inventarios/${count.id}`} key={count.id}><div><strong className="block">{count.reference}</strong><span className="text-sm text-muted-foreground">{count.countedLines}/{count.lineCount} produtos contados · {new Date(count.createdAt).toLocaleString("pt-BR")}</span></div><span className="rounded-full bg-muted px-3 py-1 text-xs">{labels[count.status]}</span></Link>)}</div></section>}</div>
}

export function InventoryCountDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<CountDetail | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setDetail(await read(await erpFetch(`/api/erp/inventory-counts/${id}`, { cache: "no-store" }))); setError("") } catch (cause) { setError(cause instanceof Error ? cause.message : "Inventário indisponível") } }, [id])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  async function save(line: CountLine, value: string) { setBusy(true); try { await read(await erpFetch(`/api/erp/inventory-counts/${id}/lines`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ productId: line.productId, countedQuantity: value }) })); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : "Contagem não salva") } finally { setBusy(false) } }
  async function approve() { setBusy(true); try { await read(await erpFetch(`/api/erp/inventory-counts/${id}/approve`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } })); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : "Aprovação não realizada") } finally { setBusy(false) } }
  if (!detail) return <div className="mx-auto max-w-[1450px] px-4 py-8 lg:px-6"><p role={error ? "alert" : "status"}>{error || "Carregando inventário…"}</p></div>
  const { count, lines } = detail
  return <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6"><PageHeader eyebrow="Estoque / Inventários" title={count.reference} description={`${count.countedLines} de ${count.lineCount} produtos contados.`} back={{ href: "/estoque/inventarios", label: "Inventários" }} actions={<Button disabled={busy || count.status !== "open" || count.countedLines !== count.lineCount} onClick={() => void approve()}><Check />Aprovar ajustes</Button>} />{error && <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">{error}</p>}<section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"><div className="divide-y divide-border">{lines.map(line => <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_160px_130px] sm:items-center" key={line.productId}><div><strong className="block">{line.name}</strong><span className="text-sm text-muted-foreground">{line.sku} · esperado {line.expectedQuantity} {line.unit}</span></div><Input aria-label={`Quantidade contada de ${line.name}`} defaultValue={line.countedQuantity ?? ""} type="number" min="0" step="0.000001" disabled={busy || count.status !== "open"} onBlur={event => { const value = event.currentTarget.value; if (value !== "" && value !== line.countedQuantity) void save(line, value) }} placeholder="Contado" /><span className="text-xs text-muted-foreground">{line.countedQuantity == null ? "Pendente" : "Contado"}</span></div>)}</div></section></div>
}
