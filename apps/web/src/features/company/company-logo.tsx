"use client"

import Image from "next/image"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function CompanyLogo({ value, disabled, onChange, onBusy }: { value: string; disabled: boolean; onChange: (value: string) => void; onBusy: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <div className="space-y-4">
    <div className="flex min-h-32 items-center justify-center rounded-xl border bg-white p-4">
      {value ? <Image unoptimized src={value} alt="Logo da empresa" width={1024} height={1024} className="h-auto max-h-32 w-auto max-w-full object-contain" /> : <p className="text-sm text-slate-600">Nenhuma logo cadastrada</p>}
    </div>
    <label className="field">Selecionar logo da empresa<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={async event => {
      event.stopPropagation()
      const input = event.currentTarget
      const file = input.files?.[0]
      if (!file) return
      setError(""); setBusy(true); onBusy(true)
      let bitmap: ImageBitmap | undefined
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Escolha PNG, JPG ou WebP de até 10 MB.")
        bitmap = await createImageBitmap(file)
        if (bitmap.width * bitmap.height > 16_000_000) throw new Error("Escolha uma imagem de até 16 megapixels.")
        let size = 1024
        let logo = ""
        do {
          const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const context = canvas.getContext("2d")
          if (!context) throw new Error("Não foi possível preparar a imagem neste navegador.")
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          logo = canvas.toDataURL("image/png")
          size = Math.floor(size / 2)
        } while (logo.length > 349000 && size >= 128)
        if (logo.length > 349000) throw new Error("Escolha uma imagem menor para a logo.")
        onChange(logo)
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir a imagem.") }
      finally { bitmap?.close(); input.value = ""; setBusy(false); onBusy(false) }
    }} /></label>
    <p className="text-sm text-muted-foreground">PNG, JPG ou WebP. A logo aparece no cabeçalho da proposta e no PDF.</p>
    {busy && <p role="status">Preparando logo…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {value && <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => { onChange(""); setError("") }}>Remover logo</Button>}
  </div>
}
