"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RequestError } from "@/components/feedback/session-recovery"
import { useCommand, useResource } from "@/hooks/use-operation"

type Delivery = { id: string; status: "sent" | "failed" | "uncertain"; recipient: string; createdAt: string }
type EmailStatus = { tenantId: string; recipient: string | null; canSend: boolean; emailReady: boolean; deliveries: Delivery[] }
type Receipt = { tenantId: string; revision: number; delivery: Delivery }
const deliveryLabels = { sent: "Aceito pelo servidor de e-mail", failed: "Recusado pelo servidor de e-mail", uncertain: "Confirmação pendente · não reenviar" }

export function ProposalEmail({ id, number, version, tenantId, etag, onReload, disabled = false }: { id: string; number: string; version: number; tenantId: string; etag: string; onReload: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  // Only consult delivery configuration/history when the composer is opened.
  return <>
    <Button variant="outline" className="h-9 px-3" disabled={disabled} title={disabled ? "Consulte a versão atual e aguarde operações pendentes para enviar" : undefined} onClick={() => setOpen(true)}>Enviar por e-mail</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Enviar proposta {number} por e-mail</DialogTitle><DialogDescription>Confira o destinatário e a mensagem antes de enviar o documento da proposta.</DialogDescription></DialogHeader>
        {open && <ProposalEmailComposer id={id} number={number} version={version} tenantId={tenantId} etag={etag} onReload={onReload} />}
      </DialogContent>
    </Dialog>
  </>
}

function ProposalEmailComposer({ id, number, version, tenantId, etag, onReload }: { id: string; number: string; version: number; tenantId: string; etag: string; onReload: () => void }) {
  const messageId = useId()
  const resource = useResource<EmailStatus>(`/api/erp/proposals/${id}/email`)
  const command = useCommand()
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null)
  const [subject, setSubject] = useState(`Proposta ${number} · versão ${version}`)
  const [message, setMessage] = useState(`Olá,\n\nSegue em anexo a proposta ${number} para sua conferência.\n\nFicamos à disposição.`)
  const [receipt, setReceipt] = useState<Delivery | null>(null)
  const value = resource.value?.tenantId === tenantId ? resource.value : null
  const recipient = recipientOverride ?? value?.recipient ?? ""
  const pendingDelivery = receipt?.status === "uncertain" || value?.deliveries.some(delivery => delivery.status === "uncertain")
  const frozen = command.busy || command.uncertain || command.stale || !!pendingDelivery || receipt?.status === "sent"
  if (resource.loading && !value) return <p role="status">Consultando envio de e-mail…</p>
  if (resource.error || !value) return <div className="space-y-3"><p role="alert"><RequestError message={resource.error || "Não foi possível consultar o envio desta proposta."} status={resource.status} /></p><Button variant="outline" onClick={resource.reload}>Consultar novamente</Button></div>
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault()
    if (!command.uncertain && (!value.canSend || !value.emailReady || frozen)) return
    const result = await command.send<Receipt>(`/api/erp/proposals/${id}/email`, tenantId, { recipient, subject, message }, etag)
    if (result?.tenantId === tenantId) { setReceipt(result.delivery); resource.reload(); if (result.delivery.status === "sent") onReload() }
  }}>
    {!value.emailReady && <p role="status" className="rounded-lg border p-3">O envio de e-mail ainda não está configurado no servidor. Nenhuma mensagem será enviada até a configuração estar disponível.</p>}
    {!value.canSend && <p role="status">Envio indisponível: confira sua permissão, a validade e a situação da proposta.</p>}
    <fieldset disabled={frozen || !value.canSend || !value.emailReady} className="space-y-3">
      <label className="block space-y-2">Destinatário<Input type="email" autoComplete="email" required maxLength={254} value={recipient} onChange={event => setRecipientOverride(event.target.value)} /></label>
      <label className="block space-y-2">Assunto<Input required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <div className="space-y-2"><label htmlFor={messageId} className="block">Mensagem</label><textarea id={messageId} required maxLength={10000} rows={5} className="w-full rounded-lg border border-input bg-background p-3" value={message} onChange={event => setMessage(event.target.value)} /></div>
    </fieldset>
    <p className="rounded-lg border bg-muted/30 p-3 text-sm">Anexo: documento da proposta em HTML, com cliente, itens, acabamentos e valores registrados. A versão da proposta é capturada pelo servidor no momento do envio.</p>
    {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
    {command.stale && <Button type="button" variant="outline" onClick={() => { command.reset(); onReload(); resource.reload() }}>Recarregar proposta</Button>}
    {receipt && <p role="status">{deliveryLabels[receipt.status]} · {receipt.recipient}{receipt.status === "sent" ? ". A entrega na caixa do destinatário depende do provedor." : "."}</p>}
    {pendingDelivery && <p role="status">Há um envio sem confirmação definitiva. Consulte o histórico e confirme com o provedor antes de realizar outro envio.</p>}
    {command.uncertain && <p role="status">Resultado ainda não confirmado. A consulta abaixo repete o mesmo comando, sem criar um novo envio.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={command.busy || command.stale || (!command.uncertain && (!value.canSend || !value.emailReady || frozen || !etag))}>{command.busy ? "Confirmando envio…" : command.uncertain ? "Consultar resultado do envio" : "Enviar e-mail com anexo"}</Button>
      <Button type="button" variant="outline" disabled={command.busy} onClick={resource.reload}>Atualizar histórico</Button>
    </div>
    {!!value.deliveries.length && <details><summary className="cursor-pointer text-sm font-medium">Histórico de envios</summary><ul className="mt-3 space-y-3 text-sm">{value.deliveries.map(delivery => <li key={delivery.id} className="break-words rounded-lg border p-3">{deliveryLabels[delivery.status]}<br />{delivery.recipient} · {new Date(delivery.createdAt).toLocaleString("pt-BR")}</li>)}</ul></details>}
  </form>
}
