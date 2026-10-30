"use client"

import Image from "next/image"
import { ImageIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export function ProductThumbnail({ id, name, tenantId, hasPhoto }: { id: string; name: string; tenantId: string; hasPhoto?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const [photo, setPhoto] = useState("")
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!hasPhoto || !root.current) return
    const controller = new AbortController()
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void fetch(`/api/erp/products/${id}`, { cache: "no-store", signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("Foto indisponível")
        const result = await response.json()
        if (result.tenantId !== tenantId || result.data?.id !== id) throw new Error("Empresa ou produto alterado")
        if (!controller.signal.aborted) setPhoto(result.data.photoDataUrl || "")
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    }, { rootMargin: "100px" })
    observer.observe(root.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [id, tenantId, hasPhoto])
  return <div ref={root} className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/40" title={failed ? "Não foi possível carregar a foto" : !hasPhoto ? "Sem foto cadastrada" : undefined}>
    {photo ? <Image unoptimized src={photo} alt={`Foto de ${name}`} width={56} height={56} className="size-14 object-contain" onError={() => { setPhoto(""); setFailed(true) }} /> : <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />}
  </div>
}
