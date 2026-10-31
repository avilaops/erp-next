"use client"

import Image from "next/image"
import { Expand, X } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

const previewAlt = "Catálogo de produtos do Ávila ERP com busca, filtros, SKU, unidade, preço e situação. Os registros são demonstrativos."

export function ErpEntryPreview() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"overview" | "details">("overview")
  const captureId = useId()
  const hintId = useId()

  return (
    <Dialog open={open} onOpenChange={nextOpen => {
      setOpen(nextOpen)
      if (nextOpen) setView("overview")
    }}>
      <DialogTrigger
        aria-label="Ampliar prévia do ERP"
        className="group mt-5 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/20 bg-white text-left text-stone-900 shadow-xl shadow-black/15 focus-visible:ring-white focus-visible:ring-offset-[#134e4a]"
      >
        <Image
          src="/erp-preview.webp"
          alt=""
          width={1120}
          height={760}
          sizes="(min-width: 1280px) 510px, (min-width: 1024px) 45vw, (min-width: 640px) 80vw, 90vw"
          loading="eager"
          className="aspect-[16/10] w-full object-cover object-top"
        />
        <span className="flex min-h-12 items-center justify-between gap-3 border-t border-stone-200 px-4 text-xs font-medium transition-colors group-hover:bg-teal-50">
          Explorar a interface<Expand aria-hidden="true" className="size-4 shrink-0 text-teal-700" />
        </span>
      </DialogTrigger>

      <DialogContent showCloseButton={false} className="flex h-[min(48rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 flex-row items-start justify-between gap-4 border-b p-4">
          <div className="space-y-2">
            <DialogTitle>Por dentro do Ávila ERP</DialogTitle>
            <DialogDescription>Catálogo de produtos · Dados demonstrativos</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" className="size-11 shrink-0" aria-label="Fechar prévia" />}>
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </DialogHeader>
        <div role="group" aria-label="Tamanho da prévia" className="flex shrink-0 gap-1 border-b px-4 py-2">
          <Button type="button" variant={view === "overview" ? "default" : "ghost"} className="min-h-11 px-3" aria-pressed={view === "overview"} aria-controls={captureId} onClick={() => setView("overview")}>
            Visão geral
          </Button>
          <Button type="button" variant={view === "details" ? "default" : "ghost"} className="min-h-11 px-3" aria-pressed={view === "details"} aria-controls={captureId} onClick={() => setView("details")}>
            Ver detalhes
          </Button>
        </div>
        <div key={view} id={captureId} role="region" aria-label="Captura ampliada do catálogo" aria-describedby={hintId} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto bg-stone-100 focus-visible:ring-inset">
          <Image src="/erp-preview.webp" alt={previewAlt} width={1120} height={760} unoptimized loading="eager" className={view === "overview" ? "h-full w-full object-contain" : "h-auto w-full min-w-[800px]"} />
        </div>
        <p id={hintId} aria-live="polite" className="shrink-0 border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
          {view === "overview" ? "Use Ver detalhes para ampliar a imagem." : "Deslize na imagem ou use as setas do teclado para explorar os detalhes."}
        </p>
      </DialogContent>
    </Dialog>
  )
}
