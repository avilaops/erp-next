"use client"

import { useEffect, useRef, useState } from "react"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { Button } from "@/components/ui/button"

export type PositionedField = { id: string; name: string; page: number; x: number; y: number; width: number; height: number }

export function TemplateCanvas({ source, fields, disabled, onPages, onMove }: {
  source: string; fields: PositionedField[]; disabled: boolean
  onPages: (count: number) => void
  onMove: (id: string, position: { x: number; y: number }) => void
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined
    const controller = new AbortController()
    async function load() {
      try {
        const engine = await import("pdfjs-dist")
        engine.GlobalWorkerOptions.workerSrc = "/assets/contract-editor-worker"
        const response = await fetch(source, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("Não foi possível carregar o PDF.")
        const data = new Uint8Array(await response.arrayBuffer())
        if (!active) return
        task = engine.getDocument({ data, stopAtErrors: true })
        const pdf = await task.promise
        if (!active) return
        if (pdf.numPages > 100) throw new Error("O modelo deve ter até 100 páginas.")
        onPages(pdf.numPages); setDocument(pdf)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "PDF indisponível.")
      }
    }
    void load()
    return () => { active = false; controller.abort(); void task?.destroy() }
  }, [source, onPages])
  if (error) return <p role="alert">{error}</p>
  if (!document) return <p role="status">Preparando páginas do PDF…</p>
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Página anterior</Button><span>Página {page} de {document.numPages}</span><Button type="button" variant="outline" disabled={page >= document.numPages} onClick={() => setPage(page + 1)}>Próxima página</Button></div>
    <p className="text-sm">Arraste os campos para posicionar. Com o campo selecionado, as setas do teclado movem 1%; Shift + seta move 0,1%. Os valores também podem ser ajustados no formulário.</p>
    <RenderedPage key={page} document={document} page={page} fields={fields.filter(field => field.page === page)} disabled={disabled} onMove={onMove} />
  </div>
}

function RenderedPage({ document, page, fields, disabled, onMove }: {
  document: PDFDocumentProxy; page: number; fields: PositionedField[]; disabled: boolean
  onMove: (id: string, position: { x: number; y: number }) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    let rendering: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined
    async function render() {
      try {
        const pdfPage = await document.getPage(page)
        if (!active || !canvas.current) return
        const viewport = pdfPage.getViewport({ scale: 1.4 })
        const target = canvas.current
        target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height)
        rendering = pdfPage.render({ canvas: target, viewport })
        await rendering.promise
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Página indisponível.")
      }
    }
    void render()
    return () => { active = false; rendering?.cancel() }
  }, [document, page])
  function move(field: PositionedField, x: number, y: number) {
    const round = (value: number, maximum: number) => Math.round(Math.max(0, Math.min(maximum, value)) * 100) / 100
    onMove(field.id, { x: round(x, 100 - field.width), y: round(y, 100 - field.height) })
  }
  return <>
    {error && <p role="alert">{error}</p>}
    <div ref={surface} className="relative mx-auto w-full max-w-[900px] overflow-hidden border bg-white">
      <canvas ref={canvas} className="block h-auto w-full" aria-label={`Documento, página ${page}`} />
      {fields.map(field => <button key={field.id} type="button" disabled={disabled} aria-label={`Posicionar ${field.name || "campo sem nome"}`} className="absolute touch-none overflow-hidden border-2 border-teal-800 bg-teal-100/80 px-1 text-left text-xs text-teal-950 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        style={{ left: `${field.x}%`, top: `${field.y}%`, width: `${field.width}%`, height: `${field.height}%` }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: field.id, startX: event.clientX, startY: event.clientY, x: field.x, y: field.y } }}
        onPointerMove={event => { const start = drag.current; const bounds = surface.current?.getBoundingClientRect(); if (!start || start.id !== field.id || !bounds || !bounds.width || !bounds.height) return; move(field, start.x + (event.clientX - start.startX) / bounds.width * 100, start.y + (event.clientY - start.startY) / bounds.height * 100) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? 0.1 : 1; move(field, field.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), field.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0)) }}>
        {field.name || "Campo sem nome"}
      </button>)}
    </div>
  </>
}
