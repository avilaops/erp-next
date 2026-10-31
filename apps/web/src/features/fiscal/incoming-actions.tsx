"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/features/operations/use-operation"
import { PurchaseLookup, type PurchaseChoice } from "@/features/purchasing/purchase-lookup"
import type { ReceivedNote } from "./received-documents"

type DistributionStatus = { tenantId: string; revision: number; lastNsu: string; maxNsu: string; nextQueryAt: string | null; lastCode: string | null; running: boolean }
type DistributionResult = DistributionStatus & { status: "completed" | "failed" | "unknown" | "running" }
type FiscalItem = { number: number; sourceCode: string; name: string; unit: string; quantityMicros: number; landedCents: number }
type Conversion = { receivedNfeId: number; revision: number; purchaseOrderId: string | null; canConvert: boolean; items: FiscalItem[] }
type Manifestation = { id: string; accessKey: string; kind: string; revision?: number; status: "pending" | "accepted" | "rejected" | "unknown"; result?: { reason?: string }; reconciliation?: { status: string } }
type Access = { tenant: { id: string }; permissions?: string[] }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const manifestLabels: Record<string, string> = { ciencia: "Ciência da emissão", confirmacao: "Confirmação da operação", desconhecimento: "Desconhecimento da operação", nao_realizada: "Operação não realizada" }
const resultLabels = { pending: "Aguardando resultado", accepted: "Registrada", rejected: "Recusada", unknown: "Resultado incerto: consulte antes de reenviar" }

export function DistributionActions({ tenantId, onChanged }: { tenantId: string; onChanged: () => void }) {
  const status = useResource<DistributionStatus>("/api/erp/fiscal/distribution/status")
  const command = useCommand()
  const [notice, setNotice] = useState("")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  const current = status.value?.tenantId === tenantId ? status.value : null
  const cooling = !!current?.nextQueryAt && new Date(current.nextQueryAt).getTime() > now
  async function query() {
    if (!current) return
    const result = await command.send<DistributionResult>("/api/erp/fiscal/distribution/query", tenantId, {}, status.etag)
    if (result) {
      setNotice(result.status === "completed" ? "Consulta concluída. Os documentos recebidos estão armazenados nesta empresa." : result.status === "running" ? "Consulta em andamento. Atualize o estado antes de iniciar outra." : "A consulta não foi confirmada. O cursor foi preservado; consulte o estado antes de tentar novamente.")
      status.reload(); onChanged()
    }
  }
  return <section className="form-section min-w-0 space-y-4" aria-labelledby="distribution-title">
    <h2 id="distribution-title" className="text-lg font-semibold">Consultar notas na SEFAZ</h2>
    <p className="text-sm text-muted-foreground">Busca documentos destinados à empresa em homologação. Configure o certificado A1 nas preferências fiscais.</p>
    {status.loading ? <p role="status">Consultando estado da distribuição…</p> : status.error ? <p role="alert">{status.error}</p> : current && <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Último documento consultado</dt><dd className="break-all">{current.lastNsu}</dd></div><div><dt className="text-muted-foreground">Último documento disponível</dt><dd className="break-all">{current.maxNsu}</dd></div></dl>
      {current.running && <p role="status">Uma consulta já está em andamento.</p>}
      {cooling && <p role="status">Próxima consulta permitida após {new Date(current.nextQueryAt!).toLocaleString("pt-BR")}.</p>}
      <Button disabled={command.busy || command.stale || !command.uncertain && (current.running || cooling)} onClick={() => void query()}>{command.busy ? "Consultando SEFAZ…" : command.uncertain ? "Conferir consulta anterior" : "Consultar notas agora"}</Button>
    </>}
    <Button variant="outline" disabled={status.loading || command.busy} onClick={() => { command.reset(); status.reload() }}>Atualizar estado da consulta</Button>
    {command.error && <p role="alert">{command.error}</p>}
    {command.uncertain && <p role="status">A resposta não foi confirmada. Conferir consulta anterior preserva o comando enviado.</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}

export function ReceivedActions({ note, tenantId }: { note: ReceivedNote; tenantId: string }) {
  const access = useResource<Access>("/api/erp/me")
  const canManifest = access.value?.tenant.id === tenantId && access.value.permissions?.includes("fiscal.received_nfe.manage")
  if (note.environment !== 2) return <p className="text-sm text-muted-foreground">Distribuição, manifestação e conversão operacional estão disponíveis em homologação.</p>
  return <>
    <PurchaseConversion note={note} tenantId={tenantId} />
    {canManifest && <RecipientManifestation note={note} tenantId={tenantId} />}
  </>
}

function PurchaseConversion({ note, tenantId }: { note: ReceivedNote; tenantId: string }) {
  const url = `/api/erp/fiscal/received-nfes/${note.id}/purchase`
  const snapshot = useResource<Conversion>(url)
  const command = useCommand()
  const [supplier, setSupplier] = useState<PurchaseChoice | null>(null)
  const [mapping, setMapping] = useState<Record<number, PurchaseChoice>>({})
  const [activeItem, setActiveItem] = useState(1)
  const [dueDate, setDueDate] = useState("")
  const [created, setCreated] = useState("")
  const [error, setError] = useState("")
  const frozen = command.busy || command.uncertain || command.stale
  const purchaseId = created || snapshot.value?.purchaseOrderId
  const items = snapshot.value?.items || []
  const complete = !!supplier && !!dueDate && items.length > 0 && items.every(item => !!mapping[item.number])
  async function convert(event: React.FormEvent) {
    event.preventDefault()
    if (!supplier || !complete) return
    const result = await command.send<{ purchaseOrderId: string }>(url, tenantId, { supplierId: supplier.id, dueDate, items: items.map(item => ({ itemNumber: item.number, productId: mapping[item.number].id })) }, snapshot.etag)
    if (result) { setCreated(result.purchaseOrderId); snapshot.reload() }
  }
  return <section className="form-section min-w-0 space-y-4" aria-labelledby="conversion-title">
    <h2 id="conversion-title" className="text-lg font-semibold">Criar compra a partir da nota</h2>
    <p className="text-sm text-muted-foreground">Selecione o fornecedor correspondente a {note.issuerName} e vincule cada item ao seu catálogo. O rascunho conserva os custos fiscais; o recebimento físico e a conta a pagar são registrados depois, no fluxo de compras.</p>
    {snapshot.loading && !created ? <p role="status">Conferindo itens e vínculo da compra…</p> : snapshot.error ? <><p role="alert">{snapshot.error}</p><Button variant="outline" onClick={snapshot.reload}>Recarregar vínculo da compra</Button></> : purchaseId ? <div className="space-y-3"><p role="status">Esta nota está vinculada a uma compra.</p><Link className="text-primary underline" href={`/compras/pedidos/${purchaseId}`}>Abrir compra vinculada</Link></div> : !snapshot.value?.canConvert ? <p>Solicite permissão para criar pedidos de compra nesta empresa.</p> : <>
      <PurchaseLookup supplier disabled={frozen} choose={value => { setSupplier(value); setError("") }} />
      <p className="text-sm"><strong>Fornecedor selecionado:</strong> {supplier?.legalName || "Nenhum fornecedor selecionado"}</p>
      <div className="space-y-3">{items.map(item => <article key={item.number} className="min-w-0 rounded-xl border p-4">
        <h3 className="break-words font-medium">Item {item.number}: {item.name}</h3>
        <p className="text-sm text-muted-foreground">{item.sourceCode} · {(item.quantityMicros / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {item.unit} · Custo posto: {money.format(item.landedCents / 100)}</p>
        <p className="mt-2 break-words text-sm">Produto vinculado: {mapping[item.number]?.name || "Selecione um produto do catálogo"}</p>
      </article>)}</div>
      <label className="block space-y-2 text-sm">Item da nota para vincular produto<select className="block w-full min-w-0 rounded-xl border bg-background p-3" disabled={frozen} value={activeItem} onChange={event => setActiveItem(Number(event.target.value))}>{items.map(item => <option key={item.number} value={item.number}>Item {item.number}: {item.name}</option>)}</select></label>
      <PurchaseLookup disabled={frozen} choose={product => {
        const source = items.find(item => item.number === activeItem)
        if (!source) return
        if (source.unit !== product.unit) { setError(`A unidade do produto deve ser ${source.unit}, conforme o XML.`); return }
        if (Object.entries(mapping).some(([number, value]) => Number(number) !== activeItem && value.id === product.id)) { setError("Este produto já está vinculado a outro item da nota."); return }
        setMapping(previous => ({ ...previous, [activeItem]: product })); setError("")
      }} />
      <form className="space-y-4" onSubmit={convert}>
        <label className="block space-y-2 text-sm">Vencimento da compra importada<Input type="date" required disabled={frozen} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        <Button type="submit" disabled={command.busy || command.stale || !complete}>{command.busy ? "Criando compra…" : command.uncertain ? "Conferir criação da compra" : "Criar rascunho com custos da nota"}</Button>
      </form>
    </>}
    {(error || command.error) && <p role="alert">{error || command.error}</p>}
    {command.uncertain && <p role="status">Confirmação pendente. Os vínculos e o vencimento foram preservados; confira usando o mesmo comando.</p>}
    {command.stale && <Button variant="outline" onClick={() => { command.reset(); snapshot.reload() }}>Recarregar vínculo da compra</Button>}
  </section>
}

function RecipientManifestation({ note, tenantId }: { note: ReceivedNote; tenantId: string }) {
  const history = useResource<{ data: Manifestation[] }>(`/api/erp/fiscal/manifestations?accessKey=${encodeURIComponent(note.accessKey)}`)
  const command = useCommand()
  const [kind, setKind] = useState("ciencia")
  const [justification, setJustification] = useState("")
  const [notice, setNotice] = useState("")
  const existing = history.value?.data.filter(item => item.accessKey === note.accessKey) || []
  const requested = existing.some(item => item.kind === kind)
  const frozen = command.busy || command.uncertain || command.stale
  return <section className="form-section min-w-0 space-y-4" aria-labelledby="manifestation-title">
    <h2 id="manifestation-title" className="text-lg font-semibold">Manifestação do destinatário</h2>
    <p className="text-sm text-muted-foreground">Registre a posição da empresa sobre esta operação em homologação.</p>
    {history.error && <p role="alert">{history.error}</p>}
    {existing.map(item => <div key={item.id} className="space-y-2 text-sm"><p>{manifestLabels[item.kind]}: {resultLabels[item.status]}{item.result?.reason ? ` · ${item.result.reason}` : ""}</p>{["pending", "unknown"].includes(item.status) && <Button variant="outline" disabled={command.busy || command.stale} onClick={async () => {
      const result = await command.send<Manifestation>(`/api/erp/fiscal/manifestations/${item.id}/reconcile`, tenantId, {}, `"${item.revision || 1}"`)
      if (result) { setNotice(result.status === "accepted" ? "Manifestação confirmada pela evidência recebida da SEFAZ." : "Ainda sem recibo distribuído. Atualize a consulta de notas após o intervalo permitido e confira novamente."); history.reload() }
    }}>Conferir recibo da manifestação</Button>}</div>)}
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault()
      const result = await command.send<Manifestation>("/api/erp/fiscal/manifestations", tenantId, { accessKey: note.accessKey, kind, justification: kind === "nao_realizada" ? justification : null }, '"1"')
      if (result) { setNotice(resultLabels[result.status]); history.reload() }
    }}>
      <label className="block space-y-2 text-sm">Tipo de manifestação<select className="block w-full rounded-xl border bg-background p-3" disabled={frozen} value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(manifestLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {kind === "nao_realizada" && <label className="block space-y-2 text-sm">Motivo da operação não realizada<Input required minLength={15} maxLength={255} disabled={frozen} value={justification} onChange={event => setJustification(event.target.value)} /></label>}
      <Button type="submit" disabled={command.busy || command.stale || !command.uncertain && (requested || history.loading || !!history.error)}>{command.busy ? "Registrando manifestação…" : command.uncertain ? "Conferir manifestação enviada" : "Registrar manifestação"}</Button>
    </form>
    <Button variant="outline" disabled={history.loading || command.busy} onClick={history.reload}>Consultar resultado da manifestação</Button>
    {command.error && <p role="alert">{command.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {command.uncertain && <p role="status">Resposta pendente. Conferir usa o mesmo comando e evita uma segunda solicitação.</p>}
  </section>
}
