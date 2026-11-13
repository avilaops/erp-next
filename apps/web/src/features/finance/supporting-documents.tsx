"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { useCommand, useResource } from "@/hooks/use-operation"

export const documentLimit = 10 * 1024 * 1024
export type SupportingDocumentInput = { filename: string; mediaType: string; contentBase64: string; description: string; documentDate?: string | null }
type Document = { id: string; orderId: string; paymentId?: string | null; filename: string; mediaType: string; byteSize: number; sha256: string; description: string; documentDate?: string | null; uploadedAt: string; uploadedBy: string }
type Documents = { tenantId: string; orderId: string; canAttachOther: boolean; canAttachPayment: boolean; data: Document[] }
export type PaymentOption = { id: string; label: string }
export const financeSelect = "block h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"

export async function supportingDocument(file: File, description: string, documentDate?: string): Promise<SupportingDocumentInput> {
  if (!file.size || file.size > documentLimit) throw new Error("Envie um arquivo de até 10 MiB.")
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Escolha PDF, PNG ou JPEG.")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const signature = Array.from(bytes.subarray(0, 8))
  const valid = file.type === "application/pdf" ? String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-"
    : file.type === "image/png" ? signature.join(",") === "137,80,78,71,13,10,26,10" : signature[0] === 255 && signature[1] === 216 && signature[2] === 255
  if (!valid) throw new Error("O conteúdo do arquivo não corresponde ao formato informado.")
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return { filename: file.name, mediaType: file.type, contentBase64: btoa(binary), description: description.trim(), documentDate: documentDate || null }
}

type DocumentsProps = { orderId: string; payments: PaymentOption[]; paymentScope?: string[]; refresh?: number; disabled?: boolean; onLockChange?: (locked: boolean) => void }

export function SupportingDocuments({ orderId, payments, paymentScope, refresh = 0, disabled, onLockChange }: DocumentsProps) {
  return <DocumentsPanel key={orderId} orderId={orderId} payments={payments} paymentScope={paymentScope} refresh={refresh} disabled={disabled} onLockChange={onLockChange} />
}

function DocumentsPanel({ orderId, payments, paymentScope, refresh, disabled = false, onLockChange }: DocumentsProps) {
  const resource = useResource<Documents>(`/api/erp/orders/${orderId}/documents`)
  useEffect(() => {
    if (refresh) resource.reload()
    // Reload is intentionally driven by the parent's completed receipt counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])
  const command = useCommand()
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [description, setDescription] = useState("")
  const [date, setDate] = useState("")
  const [payment, setPayment] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [preparing, setPreparing] = useState(false)
  const value = resource.value?.orderId === orderId && Array.isArray(resource.value.data) ? resource.value : null
  const choices = payments.filter(p => !paymentScope || paymentScope.includes(p.id))
  const allowOther = Boolean(value?.canAttachOther && !paymentScope)
  const selected = payment || (!allowOther ? choices[0]?.id || "" : "")
  const canAttach = allowOther || Boolean(value?.canAttachPayment && choices.length)
  const frozen = preparing || command.busy || command.uncertain || command.stale
  useEffect(() => { onLockChange?.(frozen) }, [frozen, onLockChange])
  useEffect(() => () => onLockChange?.(false), [onLockChange])
  useNavigationGuard(command.uncertain || preparing || command.busy ? "Há um documento aguardando confirmação. Sair pode impedir a conferência do mesmo comando. Deseja sair?" : null)
  const documents = value?.data.filter(d => !paymentScope || Boolean(d.paymentId && paymentScope.includes(d.paymentId))) || []
  return <section aria-label="Outros documentos" className="min-w-0 space-y-4 border-t pt-4">
    <h2 className="font-semibold">Outros documentos</h2>
    <p className="text-sm text-muted-foreground">Comprovantes e outros documentos deste pedido. Novos anexos preservam o contrato assinado e os recebimentos registrados.</p>
    {resource.loading && !value ? <p role="status">Carregando documentos…</p> : resource.error || !value ? <p role="status">{resource.status === 403 ? "Sem acesso aos documentos deste pedido." : "Documentos indisponíveis no momento."} <Button variant="outline" size="sm" onClick={resource.reload}>Consultar novamente</Button></p> : <>
      {!documents.length ? <p className="text-sm">Nenhum documento de apoio disponível.</p> : <ul className="space-y-2">{documents.map(doc => <li className="min-w-0 space-y-1 rounded-lg border p-3 text-sm" key={doc.id}>
        <a className="break-all font-medium text-primary underline" href={`/api/erp/orders/${orderId}/documents/${doc.id}`} download={doc.filename}>{doc.filename}</a>
        <p className="break-words">{doc.description}</p>
        <p className="break-words text-xs text-muted-foreground">{doc.paymentId ? choices.find(p => p.id === doc.paymentId)?.label || "Comprovante de recebimento" : "Documento do pedido"} · {doc.documentDate || doc.uploadedAt.slice(0, 10)} · {Math.ceil(doc.byteSize / 1024)} KiB</p>
        <details className="break-all text-xs text-muted-foreground"><summary className="cursor-pointer">Identificação do arquivo</summary><p>SHA-256: {doc.sha256}</p><p>Incluído por {doc.uploadedBy} em {doc.uploadedAt}</p></details>
      </li>)}</ul>}
      {canAttach && <form className="space-y-3" onSubmit={async event => {
        event.preventDefault(); if (disabled || !file || !value || preparing) return
        setError(""); setNotice(""); onLockChange?.(true); setPreparing(true)
        try {
          const document = await supportingDocument(file, description, date)
          const saved = await command.send<{ tenantId: string; orderId: string; data: Document }>(`/api/erp/orders/${orderId}/documents`, value.tenantId, { paymentId: selected || null, document }, "", "POST", reply => reply.tenantId === value.tenantId && reply.orderId === orderId && reply.data?.orderId === orderId && typeof reply.data.id === "string" && /^[0-9a-f-]{36}$/i.test(reply.data.id) && reply.data.byteSize > 0 && reply.data.byteSize <= documentLimit && reply.data.mediaType === document.mediaType)
          if (saved) { setFile(null); setFileKey(k => k + 1); setDescription(""); setDate(""); setNotice("Documento adicionado. Os recebimentos foram preservados."); resource.reload() }
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível ler o arquivo.") } finally { setPreparing(false) }
      }}>
        <fieldset disabled={disabled || frozen} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1">Vincular documento<select className={financeSelect} value={selected} onChange={event => setPayment(event.target.value)}>{allowOther && <option value="">Pedido · outros documentos</option>}{value?.canAttachPayment && choices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label className="min-w-0 space-y-1">Data do documento (opcional)<Input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label className="min-w-0 space-y-1">Arquivo do documento<Input key={fileKey} required type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] || null)} /><span className="text-xs text-muted-foreground">PDF, PNG ou JPEG · até 10 MiB</span></label>
          <label className="min-w-0 space-y-1">Descrição do documento<Input required minLength={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        </fieldset>
        {error && <p role="alert">{error}</p>}{command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.uncertain && <p role="status">Confirmação pendente. Repetir preserva o mesmo documento.</p>}
        <Button type="submit" className="h-auto max-w-full whitespace-normal" disabled={disabled || preparing || command.busy || command.stale}>{command.uncertain ? "Repetir inclusão do documento" : preparing || command.busy ? "Adicionando…" : "Adicionar documento"}</Button>
      </form>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
