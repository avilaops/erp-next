"use client"

import { catalogColorPhoto, type CatalogPalette } from "./catalog-color-photo-model"

type CatalogColorPhotosProps = {
  label: string
  options?: readonly string[]
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  palette?: CatalogPalette
  readOnly?: boolean
}

export function CatalogColorPhotos({ label, options, value, onChange, disabled, palette, readOnly = false }: CatalogColorPhotosProps) {
  const matches = [...new Set(options ?? [])].flatMap(option => {
    const photo = catalogColorPhoto(option, palette)
    return photo || readOnly ? [{ option, photo }] : []
  })
  if (!matches.length) return null

  return <div className="space-y-2" role="group" aria-label={`${label}: fotos do catálogo DHZ`}>
    <div className="flex flex-wrap gap-2">
      {matches.map(({ option, photo }) => {
        if (!photo) return <span key={option} className="self-center rounded-full border px-3 py-1 text-sm">{option}</span>
        const scale = 56 / photo.width
        const content = <>
          <span aria-hidden="true" className="flex h-10 items-center"><span className="block shrink-0 rounded-sm" style={{
            width: 56,
            height: photo.height * scale,
            backgroundImage: 'url("/catalog/dhz-hammerforce-pro-original-colors.jpeg")',
            backgroundRepeat: "no-repeat",
            backgroundSize: `${1245 * scale}px ${1759 * scale}px`,
            backgroundPosition: `${-photo.x * scale}px ${-photo.y * scale}px`,
          }} /></span>
          <span className="break-words">{option}</span>
        </>
        const cardClass = "flex w-[4.5rem] flex-col items-center gap-1 rounded-md border p-1 text-center text-xs"
        return readOnly ? <div key={option} className={cardClass}>{content}</div> : <button key={option} type="button" disabled={disabled || !onChange} aria-pressed={value === option} onClick={() => onChange?.(option)} title={option}
          className={`${cardClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${value === option ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary"}`}>{content}</button>
      })}
    </div>
    {matches.some(match => match.photo) && <a className="text-xs text-muted-foreground underline underline-offset-2" href="/catalog/dhz-hammerforce-pro-original-colors.jpeg" target="_blank" rel="noreferrer">Ver cores no catálogo DHZ · HammerForce Pro, pág. 101</a>}
  </div>
}
