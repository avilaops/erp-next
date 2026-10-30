"use client"

import Image from "next/image"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function ProductPhoto({ value, disabled, readOnly = false, onChange, onBusy }: { value?: string; disabled?: boolean; readOnly?: boolean; onChange?: (value: string) => void; onBusy?: (value: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Foto do produto">
    <h2 className="font-semibold">Foto do produto</h2>
    <div className="grid min-h-40 place-items-center rounded-lg bg-muted/40">
      {value ? <Image unoptimized src={value} alt="Foto cadastrada do produto" width={1024} height={768} className="h-52 w-full object-contain" /> : <p className="p-6 text-sm text-muted-foreground">Nenhuma foto cadastrada</p>}
    </div>
    {!readOnly && <>
      <label className="grid gap-2 text-sm">Selecionar foto do produto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={async event => {
        const input = event.currentTarget
        const file = input.files?.[0]
        if (!file) return
        setError(""); setBusy(true); onBusy?.(true)
        let bitmap: ImageBitmap | undefined
        try {
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Escolha JPG, PNG ou WebP com até 10 MB.")
          bitmap = await createImageBitmap(file)
          if (bitmap.width * bitmap.height > 40_000_000) throw new Error("A imagem excede 40 megapixels. Escolha uma versão menor.")
          const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const context = canvas.getContext("2d")
          if (!context) throw new Error("Não foi possível preparar a foto neste navegador.")
          context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          let photo = ""
          for (const quality of [0.85, 0.65, 0.45, 0.3]) {
            photo = canvas.toDataURL("image/jpeg", quality)
            if (photo.length <= 349000) break
          }
          if (!photo.startsWith("data:image/jpeg;base64,") || photo.length > 349000) throw new Error("Escolha uma foto menor para concluir o envio.")
          onChange?.(photo)
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir a imagem.") }
        finally { bitmap?.close(); input.value = ""; setBusy(false); onBusy?.(false) }
      }} /></label>
      <p className="text-xs text-muted-foreground">JPG, PNG ou WebP. A imagem é ajustada para até 1024 pixels e será gravada ao salvar o produto.</p>
      {busy && <p role="status">Preparando foto…</p>}
      {value && <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => { onChange?.(""); setError("") }}>Remover foto</Button>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>
}
