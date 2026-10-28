"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

async function digest(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}
export function DanfeDownload({ tenantId }: { tenantId: string }) {
  const [ready, setReady] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [download, setDownload] = useState<{ url: string; filename: string; xmlHash: string; pdfHash: string; environment: string } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => { setReady(true) }, [])
  useEffect(() => () => activeRequest.current?.abort(), [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  async function generate() {
    if (!file || busy) return
    setBusy(true); setError(""); setDownload(null)
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      if (!file.size || file.size > 900 * 1024) throw new Error("Selecione um XML de até 900 KiB")
      const original = await file.arrayBuffer()
      let xml: string
      try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original) }
      catch { throw new Error("O XML precisa estar codificado em UTF-8") }
      const body = JSON.stringify({ xml })
      if (new TextEncoder().encode(body).byteLength > 1024 * 1024) throw new Error("O XML excede o limite do corpo de envio")
      const response = await fetch("/api/erp/fiscal/danfe", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body, signal: controller.signal })
      if (!response.ok) { const problem = await response.json(); throw new Error(problem.title || "Geração recusada") }
      if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("Resposta sem documento PDF")
      const pdf = await response.arrayBuffer()
      const xmlHash = await digest(original), pdfHash = await digest(pdf)
      if (xmlHash !== response.headers.get("x-xml-sha256") || pdfHash !== response.headers.get("x-pdf-sha256")) throw new Error("O documento recebido não corresponde aos hashes da geração")
      const filename = response.headers.get("content-disposition")?.match(/filename="(DANFE-[0-9]{44}\.pdf)"/)?.[1]
      if (!filename) throw new Error("Nome do documento inválido")
      if (controller.signal.aborted) return
      setDownload({ url: URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })), filename, xmlHash, pdfHash, environment: response.headers.get("x-nfe-environment") === "2" ? "Homologação — sem valor fiscal" : "Produção — conforme protocolo do XML" })
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível gerar o DANFE") }
    finally { setBusy(false) }
  }
  return <section className="form-section space-y-5">
    <p>Selecione o XML completo da NF-e modelo 55, com assinatura e protocolo de autorização. O emitente ou destinatário precisa corresponder à empresa ativa.</p>
    <p className="text-sm text-muted-foreground">A geração confere o protocolo contido no arquivo, o esquema XML e a assinatura. A situação atual da nota, incluindo eventual cancelamento, depende de consulta à SEFAZ. O arquivo não é transmitido para autorização nem armazenado pelo ERP nesta operação.</p>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void generate() }}>
      <label className="block space-y-2">XML autorizado da NF-e<input className="block w-full rounded-lg border p-3" type="file" accept=".xml,application/xml,text/xml" disabled={!ready || busy} onChange={event => { setFile(event.target.files?.[0] || null); setDownload(null); setError("") }} /></label>
      <Button type="submit" disabled={!file || busy}>{busy ? "Validando XML e gerando DANFE…" : "Gerar DANFE"}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {download && <div role="status" className="space-y-3">
      <p>DANFE gerado. {download.environment}.</p>
      <a className="text-primary underline" href={download.url} download={download.filename}>Baixar DANFE em PDF</a>
      <dl className="break-all text-xs text-muted-foreground"><dt>SHA-256 do XML</dt><dd>{download.xmlHash}</dd><dt>SHA-256 do PDF</dt><dd>{download.pdfHash}</dd></dl>
    </div>}
  </section>
}
