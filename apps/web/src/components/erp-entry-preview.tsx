"use client"

import Image from "next/image"
import { Expand, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

const previewAlt = "Interface de produtos do Ávila ERP, com SKU, unidade, preço e situação. Os registros são demonstrativos."

const landscapePreviewMedia = "(orientation: landscape) and (max-height: 500px) and (max-width: 959px)"
const mobilePreviewMedia = "(max-width: 639px)"

export function ErpEntryPreview() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Ampliar imagem do ERP"
        className="group mt-5 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/20 bg-white text-left text-stone-900 shadow-xl shadow-black/15 focus-visible:ring-white focus-visible:ring-offset-[#134e4a]"
      >
        <picture className="block">
          <source media={landscapePreviewMedia} srcSet="/erp-preview-landscape.png" width={638} height={208} />
          <source media={mobilePreviewMedia} srcSet="/erp-preview-mobile.png" width={390} height={760} />
          <Image
            src="/erp-preview.webp"
            alt=""
            width={1120}
            height={760}
            sizes="(min-width: 1280px) 510px, (min-width: 1024px) 45vw, (min-width: 640px) 80vw, 90vw"
            loading="eager"
            className="block h-auto w-full"
          />
        </picture>
        <span className="flex min-h-12 items-center justify-between gap-3 border-t border-stone-200 px-4 text-xs font-medium transition-colors group-hover:bg-teal-50">
          Ampliar imagem<Expand aria-hidden="true" className="size-4 shrink-0 text-teal-700" />
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
        <div role="region" aria-label="Imagem ampliada do ERP" tabIndex={0} className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-white focus-visible:ring-inset">
          <picture className="block">
            <source media={landscapePreviewMedia} srcSet="/erp-preview-landscape.png" width={638} height={208} />
            <source media={mobilePreviewMedia} srcSet="/erp-preview-mobile.png" width={390} height={760} />
            <Image src="/erp-preview.webp" alt={previewAlt} width={1120} height={760} unoptimized loading="eager" className="block h-auto w-full" />
          </picture>
        </div>
      </DialogContent>
    </Dialog>
  )
}
