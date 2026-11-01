"use client"

import Image from "next/image"
import { Expand, LoaderCircle, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

const previewAlt = "Interface de produtos do Ávila ERP, com SKU, unidade, preço e situação. Os registros são demonstrativos."

const landscapePreviewMedia = "(orientation: landscape) and (max-height: 500px) and (max-width: 959px)"
const mobilePreviewMedia = "(max-width: 639px)"

function PreviewCapture({ attempt, expanded = false, onRetry }: { attempt: number; expanded?: boolean; onRetry?: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const suffix = attempt ? `?retry=${attempt}` : ""

  return <span className={expanded ? "relative block" : "relative block max-h-80 overflow-hidden sm:max-h-none"}>
    <picture className={state === "error" ? "hidden" : "block"}>
      <source media={landscapePreviewMedia} srcSet={"/erp-preview-landscape.png" + suffix} width={638} height={208} />
      <source media={mobilePreviewMedia} srcSet={"/erp-preview-mobile.png" + suffix} width={390} height={760} />
      <Image
        src={"/erp-preview.webp" + suffix}
        alt={expanded ? previewAlt : ""}
        width={1120}
        height={760}
        unoptimized={expanded}
        sizes={expanded ? undefined : "(min-width: 1280px) 510px, (min-width: 1024px) 45vw, (min-width: 640px) 80vw, 90vw"}
        loading="eager"
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
        className={"block h-auto w-full" + (state === "ready" ? "" : " opacity-0")}
      />
    </picture>
    {!expanded && state === "ready" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-8 bg-gradient-to-t from-white to-transparent portrait:max-sm:block" />}
    {state === "loading" && <span role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-stone-50 p-4 text-sm text-stone-600">
      <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />Carregando prévia…
    </span>}
    {state === "error" && <span role="alert" className="flex min-h-40 flex-col items-center justify-center gap-4 bg-stone-50 p-6 text-center text-sm leading-6 text-stone-700">
      <span>{expanded ? "Não foi possível carregar a prévia." : "Prévia indisponível. Amplie a imagem para tentar novamente."}</span>
      {expanded && <Button type="button" className="min-h-11" onClick={onRetry}>Tentar novamente</Button>}
    </span>}
  </span>
}

export function ErpEntryPreview() {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const capture = useRef<HTMLDivElement>(null)
  const captureKey = `${attempt}-${layoutVersion}`

  useEffect(() => {
    const landscape = window.matchMedia(landscapePreviewMedia)
    const mobile = window.matchMedia(mobilePreviewMedia)
    const layout = () => landscape.matches ? "landscape" : mobile.matches ? "mobile" : "desktop"
    let current = layout()
    function update() {
      const next = layout()
      if (next === current) return
      current = next
      if (capture.current?.contains(document.activeElement)) capture.current.focus()
      // A new picture makes load/error state follow the newly selected source.
      setLayoutVersion(value => value + 1)
    }
    landscape.addEventListener("change", update)
    mobile.addEventListener("change", update)
    return () => {
      landscape.removeEventListener("change", update)
      mobile.removeEventListener("change", update)
    }
  }, [])

  function retry() {
    capture.current?.focus()
    setAttempt(value => value + 1)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Ver tela completa do ERP"
        className="group mt-5 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/20 bg-white text-left text-stone-900 shadow-xl shadow-black/15 focus-visible:ring-white focus-visible:ring-offset-[#134e4a]"
      >
        <PreviewCapture key={captureKey} attempt={attempt} />
        <span className="flex min-h-12 items-center justify-between gap-3 border-t border-stone-200 px-4 text-xs font-medium transition-colors group-hover:bg-teal-50">
          Ver tela completa<Expand aria-hidden="true" className="size-4 shrink-0 text-teal-700" />
        </span>
      </DialogTrigger>

      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-3 border-b px-4 py-2">
          <div className="space-y-1">
            <DialogTitle>Por dentro do Ávila ERP</DialogTitle>
            <DialogDescription>Interface real · Dados demonstrativos</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" className="size-11 shrink-0" aria-label="Fechar prévia" />}>
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </DialogHeader>
        <div ref={capture} role="region" aria-label="Imagem ampliada do ERP" tabIndex={0} className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-white focus-visible:ring-inset">
          <PreviewCapture key={captureKey} attempt={attempt} expanded onRetry={retry} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
