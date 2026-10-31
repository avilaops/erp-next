"use client"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { FileCheck2, FileText, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/features/operations/use-operation"

type Recipient = { role: string; name: string; email: string }
type ContractSummary = { id: string; orderId: string; customerId: string; customerName: string; templateName: string; status: string; problem: string | null; revision: number }
type Snapshot = {
  order: { id: string; revision: number; amount: string; dueDate: string }
  company: { legalName: string; taxId: string }
  customer: { id: string; name: string; taxId: string; email: string | null }
  items: { name: string; quantity: string; unit: string; unitPrice: string; amount: string }[]
}
type Contract = ContractSummary & {
  snapshot: Snapshot; recipients: Recipient[]; fields: Record<string, string>
  externalId: number | null; reviewedAt: string | null; sendRequestedAt: string | null; completedAt: string | null
  progress: { id: number; role: string; email: string; sendConfirmed: boolean; openedAt: string | null; completedAt: string | null; declinedAt: string | null }[]
}
type StoredFile = { id: string; kind: "preview" | "signed" | "audit"; position: number; sha256: string }
type Detail = { tenantId: string; canEdit: boolean; canSend: boolean; emailReady: boolean; data: Contract; files: StoredFile[] }
type Template = { id: number; name: string; updatedAt: string; roles: { name: string; uuid: string }[]; fields: { name: string; type: string; required: boolean }[] }
type Options = { tenantId: string; canEdit: boolean; configured: boolean; emailReady: boolean; snapshot: Snapshot; templates: Template[]; defaults: Record<string, string> }
const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block min-h-10 w-full rounded-lg border bg-background px-3 py-2"
const labels: Record<string, string> = { creation_requested: "Geração em conferência", created: "Pronto para revisão", reviewed: "Revisado", send_requested: "Envio solicitado", sent: "Transmissão confirmada pelo serviço", opened: "Aberto pelo destinatário", completed: "Assinatura concluída", declined: "Assinatura recusada", expired: "Prazo expirado" }
const fieldLabels: Record<string, string> = { empresa_nome: "Nome da empresa", empresa_documento: "Documento da empresa", empresa_endereco: "Endereço da empresa", cliente_nome: "Nome do cliente", cliente_documento: "Documento do cliente", cliente_email: "E-mail do cliente", cliente_endereco: "Endereço do cliente", pedido_numero: "Número do pedido", pedido_total: "Total do pedido", vencimento: "Vencimento", itens: "Itens, quantidades e valores", condicoes: "Condições comerciais", entrega: "Condições e prazo de entrega" }

export function ContractsList({ orderId, customerId }: { orderId?: string; customerId?: string }) {
  const [offset, setOffset] = useState(0)
  const query = new URLSearchParams({ offset: String(offset), ...(orderId ? { orderId } : {}), ...(customerId ? { customerId } : {}) })
  const result = useResource<{ tenantId: string; canEdit: boolean; data: ContractSummary[]; total: number }>(`/api/erp/commercial-contracts?${query}`)
  return <>
    <PageHeader eyebrow="Ávila Ops · Comercial" title="Contratos" description="Documentos vinculados à empresa, ao cliente e ao pedido, da revisão à assinatura." />
    <div className="mb-5 flex flex-wrap gap-4">
      <Link className={linkClass} href="/servicos/contratos/modelos">Modelos de contrato</Link>
      {orderId && <Link className={linkClass} href={`/vendas/pedidos/${orderId}`}>Voltar ao pedido</Link>}
      {customerId && <Link className={linkClass} href={`/cadastros/clientes-fornecedores/${customerId}`}>Voltar ao cliente</Link>}
      {orderId && result.value?.canEdit && <Link className={linkClass} href={`/vendas/pedidos/${orderId}/contratos/novo`}>Gerar contrato</Link>}
      {!orderId && <Link className={linkClass} href="/vendas/pedidos">Abrir um pedido para gerar contrato</Link>}
    </div>
    <section className="form-section min-w-0 space-y-4">
      {result.loading ? <p role="status">Carregando contratos…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : !result.value?.data.length ? <p>Nenhum contrato encontrado.</p> : <ul className="space-y-3">
        {result.value.data.map(contract => <li key={contract.id} className="rounded-xl border p-4">
          <Link className={linkClass} href={`/servicos/contratos/${contract.id}`}>{contract.templateName}</Link>
          <p className="mt-2">{contract.customerName} · {labels[contract.status] || contract.status}</p>
          {contract.problem && <p className="mt-2 text-sm" role="status">{contract.problem}</p>}
        </li>)}
      </ul>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={result.reload}><RefreshCw />Atualizar</Button><Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Anterior</Button><Button variant="outline" disabled={offset + 25 >= (result.value?.total || 0)} onClick={() => setOffset(offset + 25)}>Próximo</Button></div>
    </section>
  </>
}

export function ContractGenerator({ orderId }: { orderId: string }) {
  const result = useResource<Options>(`/api/erp/commercial-contracts/options/${orderId}`)
  if (result.loading) return <><PageHeader eyebrow="Ávila Ops · Contratos" title="Gerar contrato" description="Consulte o pedido e os modelos disponíveis para a empresa." /><p role="status">Consultando pedido e modelos da empresa…</p></>
  if (result.error || !result.value) return <><PageHeader eyebrow="Ávila Ops · Contratos" title="Gerar contrato" description="Consulte o pedido e os modelos disponíveis para a empresa." /><Link className={linkClass} href={`/vendas/pedidos/${orderId}/contratos`}>Voltar à lista</Link><section className="form-section space-y-4"><p role="alert"><RequestError message={result.error || "Pedido indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section></>
  return <>
    <PageHeader eyebrow="Ávila Ops · Contratos" title="Gerar contrato" description="Confira os dados do pedido e complete os campos do modelo. A geração produz uma prévia e ainda não envia e-mail." />
    <Link className={linkClass} href={`/vendas/pedidos/${orderId}/contratos`}>Voltar aos contratos do pedido</Link>
    {result.value.configured && !result.value.emailReady && <p className="mt-4 rounded-lg border p-4" role="status">O e-mail de assinatura ainda não foi validado. Você pode gerar e revisar a prévia; o envio ficará bloqueado.</p>}
    {!result.value.canEdit ? <p className="mt-5" role="status">Seu acesso permite apenas consulta de pedidos e contratos.</p> : !result.value.configured || !result.value.templates.length ? <section className="form-section mt-5 space-y-3"><h2 className="font-semibold">Modelo ainda não disponível</h2><p>A conexão e os modelos de contrato desta empresa precisam ser configurados pelo administrador.</p><Button variant="outline" onClick={result.reload}>Consultar novamente</Button></section> : <GeneratorForm key={`${orderId}:${result.value.snapshot.order.revision}`} options={result.value} reload={result.reload} />}
  </>
}

function GeneratorForm({ options, reload }: { options: Options; reload: () => void }) {
  const router = useRouter()
  const command = useCommand()
  const [selected, setSelected] = useState(options.templates[0].id)
  const template = options.templates.find(value => value.id === selected)!
  const [fields, setFields] = useState<Record<string, string>>({})
  const [recipients, setRecipients] = useState<Record<string, Recipient>>({})
  const locked = command.busy || command.uncertain || command.stale
  function recipient(role: string, index: number): Recipient {
    return recipients[role] || { role, name: index === 0 ? options.snapshot.customer.name : "", email: index === 0 ? options.snapshot.customer.email || "" : "" }
  }
  const missing = template.fields.filter(field => field.required && !(options.defaults[field.name] || fields[field.name] || "").trim())
  return <form className="mt-5 space-y-5" onSubmit={async event => {
    event.preventDefault()
    const result = await command.send<Detail>("/api/erp/commercial-contracts", options.tenantId, {
      orderId: options.snapshot.order.id, orderRevision: options.snapshot.order.revision,
      templateId: template.id, templateUpdatedAt: template.updatedAt,
      recipients: template.roles.map((role, index) => recipient(role.name, index)),
      fields: Object.fromEntries(template.fields.map(field => [field.name, options.defaults[field.name] || fields[field.name] || ""])),
    })
    if (result) router.push(`/servicos/contratos/${result.data.id}`)
  }}>
    <fieldset disabled={locked} className="space-y-5">
      <section className="form-section space-y-4"><h2 className="flex items-center gap-2 font-semibold"><FileText />Modelo e pedido</h2>
        <label className="block space-y-2">Modelo de contrato<select className={selectClass} value={selected} onChange={event => { setSelected(Number(event.target.value)); setFields({}); setRecipients({}) }}>{options.templates.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <p><strong>{options.snapshot.company.legalName}</strong> · {options.snapshot.company.taxId}</p>
        <p>Cliente: {options.snapshot.customer.name} · {options.snapshot.customer.taxId}</p>
        <p>Total comercial: R$ {options.snapshot.order.amount.replace(".", ",")} · Vencimento: {options.snapshot.order.dueDate}</p>
        <p className="text-sm text-muted-foreground">Os dados serão preservados nesta geração. Mudanças posteriores no pedido não alteram o contrato.</p>
      </section>
      <section className="form-section space-y-4"><h2 className="font-semibold">Campos do documento</h2>
        {missing.length > 0 && <p role="status">Faltam {missing.length} campos obrigatórios: {missing.map(field => fieldLabels[field.name] || field.name).join(", ")}.</p>}
        {template.fields.map(field => <label key={field.name} className="block space-y-2">
          <span>{fieldLabels[field.name] || field.name}{field.required ? " *" : ""}{options.defaults[field.name] ? " · preenchido pelo pedido" : ""}</span>
          <textarea className={`${selectClass} min-h-20`} required={field.required} maxLength={20000} readOnly={Boolean(options.defaults[field.name])} value={options.defaults[field.name] || fields[field.name] || ""} onChange={event => setFields({ ...fields, [field.name]: event.target.value })} />
        </label>)}
      </section>
      <section className="form-section space-y-4"><h2 className="font-semibold">Destinatários da assinatura</h2>
        {template.roles.map((role, index) => {
          const value = recipient(role.name, index)
          return <div key={role.uuid} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><h3 className="font-medium sm:col-span-2">{role.name}</h3><label className="space-y-2">Nome<Input required maxLength={200} value={value.name} onChange={event => setRecipients({ ...recipients, [role.name]: { ...value, name: event.target.value } })} /></label><label className="space-y-2">E-mail<Input type="email" required maxLength={254} value={value.email} onChange={event => setRecipients({ ...recipients, [role.name]: { ...value, email: event.target.value } })} /></label></div>
        })}
      </section>
    </fieldset>
    {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
    {command.uncertain && <p role="status">O resultado será conferido pela mesma referência. A geração não será disparada outra vez.</p>}
    {command.stale && <Button type="button" onClick={() => { command.reset(); reload() }}>Recarregar dados do pedido</Button>}
    <Button type="submit" disabled={command.busy || command.stale || missing.length > 0}>{command.busy ? "Gerando prévia…" : command.uncertain ? "Conferir geração" : "Gerar prévia para revisão"}</Button>
  </form>
}

export function ContractDetail({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/commercial-contracts/${id}`)
  const command = useCommand()
  const [checkedRevision, setCheckedRevision] = useState("")
  const [notice, setNotice] = useState("")
  const [pendingAction, setPendingAction] = useState("")
  const [selectedFile, setSelectedFile] = useState("")
  async function action(name: string) {
    if (!result.value) return
    setPendingAction(name); setNotice("")
    const updated = await command.send<Detail>(`/api/erp/commercial-contracts/${id}/${name}`, result.value.tenantId, {}, result.etag)
    if (updated) { setNotice(name === "review" ? "Revisão registrada." : name === "send" ? "Solicitação registrada. Confira abaixo o estado confirmado pelo serviço." : "Andamento consultado no serviço de contratos."); result.reload() }
  }
  if (result.loading) return <><PageHeader eyebrow="Ávila Ops · Contratos" title="Detalhes do contrato" description="Consulte o documento, os destinatários e o andamento." /><p role="status">Carregando contrato…</p></>
  if (result.error || !result.value) return <><PageHeader eyebrow="Ávila Ops · Contratos" title="Detalhes do contrato" description="Consulte o documento, os destinatários e o andamento." /><Link className={linkClass} href="/servicos/contratos">Voltar à lista</Link><section className="form-section space-y-4"><p role="alert"><RequestError message={result.error || "Contrato indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></section></>
  const { data: contract, files, canEdit, canSend, emailReady } = result.value
  const currentFile = files.find(file => file.id === selectedFile) || files.find(file => file.kind === (contract.status === "completed" ? "signed" : "preview"))
  const blocked = command.busy || command.uncertain || command.stale
  const fileUrl = (file: StoredFile) => `/api/erp/commercial-contracts/${id}/files/${file.id}`
  return <>
    <PageHeader eyebrow="Ávila Ops · Contratos" title={contract.templateName} description={labels[contract.status] || contract.status} />
    <div className="mb-5 flex flex-wrap gap-4"><Link className={linkClass} href={`/vendas/pedidos/${contract.orderId}/contratos`}>Contratos do pedido</Link><Link className={linkClass} href={`/cadastros/clientes-fornecedores/${contract.customerId}/contratos`}>Contratos do cliente</Link></div>
    <ol className="mb-5 grid gap-2 text-sm sm:grid-cols-4" aria-label="Etapas do contrato">{["1. Gerar", "2. Revisar", "3. Enviar", "4. Acompanhar"].map(step => <li className="rounded-lg border bg-muted/40 px-4 py-3" key={step}>{step}</li>)}</ol>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="form-section min-w-0 space-y-4"><h2 className="font-semibold">Documento {contract.status === "completed" ? "assinado" : "para revisão"}</h2>
        {!files.length && <p>A prévia ainda não foi confirmada. Use “Atualizar andamento” para consultar a mesma solicitação.</p>}
        <div className="flex flex-wrap gap-3">{files.map(file => <Button key={file.id} variant={currentFile?.id === file.id ? "default" : "outline"} onClick={() => setSelectedFile(file.id)}>{file.kind === "audit" ? "Trilha de assinatura" : file.kind === "signed" ? "PDF assinado" : "Prévia"}{file.kind !== "audit" ? ` ${file.position + 1}` : ""}</Button>)}</div>
        {currentFile && <><div className="flex flex-wrap gap-4"><a className={linkClass} href={fileUrl(currentFile)} target="_blank" rel="noreferrer">Abrir documento</a><a className={linkClass} href={fileUrl(currentFile)} download={`${currentFile.kind}-${contract.id}.pdf`}>Baixar PDF</a></div><iframe title={currentFile.kind === "audit" ? "Trilha de assinatura" : "Documento do contrato"} src={fileUrl(currentFile)} className="h-[65vh] min-h-96 w-full rounded-lg border" /><p className="break-all text-xs text-muted-foreground">Cópia preservada no servidor Ávila Ops · SHA-256: {currentFile.sha256}</p></>}
      </section>
      <aside className="space-y-5">
        <section className="form-section space-y-4"><h2 className="font-semibold">Destinatários e andamento</h2><ul className="space-y-4">{contract.recipients.map(recipient => {
          const progress = contract.progress.find(item => item.role === recipient.role)
          return <li key={recipient.role} className="break-words"><strong>{recipient.name}</strong><p className="text-sm">{recipient.role} · {recipient.email}</p><p className="mt-1 text-sm">{progress?.completedAt ? "Assinou" : progress?.declinedAt ? "Recusou" : progress?.openedAt ? "Abriu o documento" : progress?.sendConfirmed ? "Transmissão de e-mail confirmada pelo serviço" : contract.sendRequestedAt ? "Envio solicitado; confirmação pendente" : "Convite ainda não solicitado"}</p></li>
        })}</ul><p className="text-sm text-muted-foreground">A confirmação de transmissão não comprova entrega na caixa de entrada.</p>
          {contract.problem && <p role="alert">{contract.problem}</p>}
          {!emailReady && !contract.sendRequestedAt && <p role="status">O e-mail de assinatura ainda não foi validado. A prévia e a revisão estão disponíveis; o envio está bloqueado.</p>}
          {notice && <p role="status">{notice}</p>}
          {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
          {command.uncertain ? <Button disabled={command.busy} onClick={() => action(pendingAction)}>Conferir resultado da operação</Button> : <Button variant="outline" disabled={blocked} onClick={() => action("sync")}><RefreshCw />Atualizar andamento</Button>}
          {command.stale && <Button variant="outline" onClick={() => { command.reset(); result.reload() }}>Recarregar contrato</Button>}
          {canEdit && canSend && contract.status === "created" && !contract.problem && <div className="space-y-4 border-t pt-4"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" disabled={blocked} checked={checkedRevision === result.etag} onChange={event => setCheckedRevision(event.target.checked ? result.etag : "")} /><span>Conferi todos os documentos, dados e destinatários desta revisão.</span></label><Button disabled={blocked || checkedRevision !== result.etag} onClick={() => action("review")}><FileCheck2 />Confirmar revisão</Button></div>}
          {canEdit && canSend && contract.status === "reviewed" && <div className="space-y-3 border-t pt-4"><p>A revisão foi registrada. O convite será enviado aos destinatários acima pelo e-mail configurado no portal.</p><Button disabled={blocked || !emailReady} onClick={() => action("send")}>Enviar para assinatura</Button></div>}
          {canEdit && !canSend && <p className="text-sm">A revisão e o envio exigem permissão específica para contratos.</p>}
        </section>
        <section className="form-section space-y-3"><h2 className="font-semibold">Dados preservados</h2><p>{contract.snapshot.company.legalName}</p><p>{contract.snapshot.customer.name} · {contract.snapshot.customer.taxId}</p><p>R$ {contract.snapshot.order.amount.replace(".", ",")} · Pedido na revisão {contract.snapshot.order.revision}</p><details><summary className="cursor-pointer font-medium">Conferir campos utilizados</summary><dl className="mt-3 space-y-3">{Object.entries(contract.fields).map(([key, value]) => <div key={key}><dt className="text-sm font-medium">{fieldLabels[key] || key}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value || "Não informado"}</dd></div>)}</dl></details><p className="break-all text-xs text-muted-foreground">Contrato {contract.id}{contract.externalId ? ` · Solicitação ${contract.externalId}` : ""}</p></section>
      </aside>
    </div>
  </>
}
