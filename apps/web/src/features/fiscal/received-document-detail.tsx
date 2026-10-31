"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Download, Eye, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchReceivedDocument, saveDocument, type ReceivedNote } from "./received-documents"
import { ReceivedActions } from "./incoming-actions"

type Detail = { tenantId: string; data: ReceivedNote }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export function ReceivedDocumentDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null)
  const operation = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/erp/fiscal/received-nfes/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json()
        if (!response.ok) throw new Error(value.title || "Nota não encontrada nesta empresa")
        if (!controller.signal.aborted) setDetail(value)
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); operation.current?.abort() }
  }, [id])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  async function openDocument(format: "xml" | "danfe") {
    if (!detail || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(format); setError("")
    if (format === "danfe") setPreview(null)
    try {
      const document = await fetchReceivedDocument(detail.data, detail.tenantId, format, controller.signal)
      if (format === "danfe") {
        setPreview({ url: URL.createObjectURL(new Blob([document.bytes], { type: document.mime })), filename: document.filename })
      } else saveDocument(document.bytes, document.mime, document.filename)
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Documento indisponível") }
    finally { operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  const note = detail?.data
  return <main className="mx-auto max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <Link className="inline-flex items-center gap-2 text-sm text-primary" href="/fiscal/monitor"><ArrowLeft className="size-4" />Voltar ao monitor</Link>
    <header className="border-b pb-6"><p className="text-sm text-primary">Fiscal / NF-e recebida</p><h1 className="mt-2 text-3xl font-semibold">{note ? `NF-e ${note.number} · Série ${note.series}` : "Documento fiscal"}</h1><p className="mt-2 text-muted-foreground">Consulte o XML armazenado e visualize seu DANFE em PDF.</p></header>
    {loading && <p role="status">Carregando documento da empresa…</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    {note && <>
      <section className="form-section space-y-4" aria-labelledby="document-title">
        <h2 id="document-title" className="flex items-center gap-2 text-lg font-semibold"><FileText className="size-5" />Dados da nota</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Emitente</dt><dd>{note.issuerName} · {note.issuerDocument}</dd></div>
          <div><dt className="text-muted-foreground">CNPJ do destinatário</dt><dd>{note.recipientDocument}</dd></div>
          <div><dt className="text-muted-foreground">Emissão</dt><dd>{new Date(note.issuedAt).toLocaleString("pt-BR")}</dd></div>
          <div><dt className="text-muted-foreground">Valor total</dt><dd>{money.format(note.totalCents / 100)} · {note.itemCount} item(ns)</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Chave de acesso</dt><dd className="break-all">{note.accessKey}</dd></div>
        </dl>
        <p className="text-sm font-medium">{note.environment === 2 ? "Homologação — sem valor fiscal" : "Ambiente de produção declarado no XML"}</p>
        <p className="text-sm text-muted-foreground">O protocolo pertence ao XML importado. A situação atual da nota, incluindo cancelamento, depende de consulta à SEFAZ. Esta ação não emite uma nova nota.</p>
      </section>
      <section className="form-section space-y-4" aria-labelledby="view-title">
        <h2 id="view-title" className="text-lg font-semibold">Visualização da nota</h2>
        <div className="flex flex-wrap gap-3">
          <Button disabled={!!busy} onClick={() => void openDocument("danfe")}><Eye className="size-4" />{busy === "danfe" ? "Validando XML e gerando PDF…" : "Visualizar DANFE"}</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => void openDocument("xml")}><Download className="size-4" />{busy === "xml" ? "Preparando XML…" : "Baixar XML"}</Button>
          {preview && <a className="inline-flex items-center gap-2 text-sm text-primary underline" href={preview.url} download={preview.filename}>Baixar DANFE em PDF</a>}
        </div>
        {preview && <div className="space-y-3"><p role="status" className="text-sm">DANFE gerado a partir do XML armazenado. Se a prévia não abrir no seu navegador, baixe o PDF.</p><iframe title="Visualização do DANFE" src={preview.url} className="h-[75vh] min-h-96 w-full rounded-xl border" /></div>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Integridade do XML</summary><p className="mt-2 break-all">SHA-256: {note.xmlSha256}</p><p className="mt-1">Importado em {new Date(note.createdAt).toLocaleString("pt-BR")}.</p></details>
      </section>
      {detail && <ReceivedActions key={`${detail.tenantId}:${note.id}`} note={note} tenantId={detail.tenantId} />}
    </>}
  </main>
}
