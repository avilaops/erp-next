"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import { orderNumber } from "./order-presentation"

export function OrderPdfDownload({ id, number, tenantId, etag, onReload }: { id: string; number: string; tenantId: string; etag: string; onReload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<AbortController | null>(null)
  const key = `${tenantId}:${id}:${etag}`
  useEffect(() => () => controller.current?.abort(), [key])

  async function download() {
    if (controller.current || !etag) return
    const request = new AbortController()
    controller.current = request; setBusy(true); setError("")
    try {
      const response = await erpFetch(`/api/erp/orders/${id}/document`, { headers: { Accept: "application/pdf", "If-Match": etag, "X-Tenant-Id": tenantId }, signal: request.signal })
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as { title?: string } | null
        throw new Error(problem?.title || "Não foi possível gerar o PDF deste pedido.")
      }
      if (!response.headers.get("content-type")?.startsWith("application/pdf") || response.headers.get("etag") !== etag) throw new Error("O documento não corresponde à revisão consultada. Atualize os dados do pedido.")
      const bytes = await response.arrayBuffer()
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("O serviço retornou um documento inválido. Tente novamente.")
      if (request.signal.aborted) return
      const disposition = response.headers.get("content-disposition") || ""
      const name = /filename="?([a-zA-Z0-9_.-]+\.pdf)"?/i.exec(disposition)?.[1] || `pedido-${orderNumber(number)}.pdf`
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      const link = document.createElement("a")
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível gerar o PDF do pedido.")
    } finally { controller.current = null; setBusy(false) }
  }
  return <div className="min-w-0 space-y-2">
    <Button type="button" variant="outline" className="h-9 w-full px-3 sm:w-auto" disabled={busy || !etag} onClick={() => void download()}>{busy ? "Preparando PDF…" : "Salvar PDF"}</Button>
    {error && <div className="max-w-md space-y-2"><p role="alert" className="text-sm">{error}</p><Button type="button" variant="outline" className="h-auto min-h-9 w-full whitespace-normal px-3 sm:w-auto" onClick={onReload}>Atualizar dados do pedido</Button></div>}
  </div>
}
