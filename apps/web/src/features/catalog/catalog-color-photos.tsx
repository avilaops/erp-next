"use client"

import { catalogColorPhoto, type CatalogPalette } from "./catalog-color-photo-model"
import { catalogFinishGroups, getCatalogFinishPalette, type CatalogFinishPart } from "./catalog-finish-palettes"

type CatalogColorPhotosProps = {
  label: string
  options?: readonly string[]
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  palette?: CatalogPalette
  part: CatalogFinishPart
  readOnly?: boolean
  showSource?: boolean
}

export function CatalogPaletteReference({ palette }: { palette?: CatalogPalette }) {
  const source = getCatalogFinishPalette(palette)?.source
  return source ? <a className="text-xs text-muted-foreground underline underline-offset-2" href={source.asset} target="_blank" rel="noreferrer">Ver paleta original e combinações · {source.title}, {source.printedPage ? `pág. ${source.printedPage}` : `PDF pág. ${source.pdfPage}`}</a> : null
}

export function CatalogColorPhotos({ label, options, value, onChange, disabled, palette, part, readOnly = false, showSource = true }: CatalogColorPhotosProps) {
  const names = [...new Set(options ?? [])]
  if (!names.length) return null
  const groups = catalogFinishGroups(palette, part, names)
  const hasPhotos = names.some(name => catalogColorPhoto(name, palette, part))
  return <div className="min-w-0 space-y-2" role="group" aria-label={`${label}: ${hasPhotos ? "fotos do catálogo DHZ" : "opções de acabamento"}`}>
    {([["standard", "Padrão"], ["special", "Especiais do catálogo"], ["other", "Outras opções cadastradas"]] as const).map(([group, title]) => groups[group].length > 0 && <div key={group} className="min-w-0 space-y-1.5">
      {(group === "special" || group === "other" && hasPhotos || group === "standard" && groups.special.length > 0) && <p className="text-xs font-medium text-muted-foreground">{title}</p>}
      <div className="flex flex-wrap gap-1.5">
      {groups[group].map(option => {
        const photo = catalogColorPhoto(option, palette, part)
        const scale = photo ? 46 / photo.width : 1
        const content = <>
          {photo && <span aria-hidden="true" className="flex h-9 items-center"><span className="block shrink-0 rounded-sm" style={{
            width: 46,
            height: photo.height * scale,
            backgroundImage: `url("${photo.asset}")`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${photo.sourceWidth * scale}px ${photo.sourceHeight * scale}px`,
            backgroundPosition: `${-photo.x * scale}px ${-photo.y * scale}px`,
          }} /></span>}
          <span className="w-full break-words">{option}</span>
        </>
        const cardClass = `${photo ? "w-18 px-0 py-1" : "min-h-11 min-w-14 max-w-36 px-2 py-1"} flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border text-center text-xs leading-tight`
        return readOnly ? <div key={option} className={cardClass}>{content}</div> : <button key={option} type="button" disabled={disabled || !onChange} aria-pressed={value === option} onClick={() => onChange?.(option)} title={option}
          className={`${cardClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${value === option ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary"}`}>{content}</button>
      })}
      </div>
    </div>)}
    {showSource && hasPhotos && <CatalogPaletteReference palette={palette} />}
  </div>
}
