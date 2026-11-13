export type CatalogFinishPalette = "dhz-hammerforce-pro" | "dhz-sforce"
export type CatalogFinishPart = "structure" | "swingArm" | "upholstery"
type FinishOptions = { readonly standard: readonly string[]; readonly special: readonly string[] }
export type CatalogFinishDefinition = Record<CatalogFinishPart, FinishOptions> & {
 readonly source: { readonly title: string; readonly asset: string; readonly pdfPage: number; readonly printedPage?: number }
}

// Transcribed from the original manufacturer pages; provenance travels with each raster.
const palettes: Record<CatalogFinishPalette, CatalogFinishDefinition> = {
 "dhz-hammerforce-pro": {
  source: { title: "HammerForce Pro", asset: "/catalog/dhz-hammerforce-pro-original-colors.jpeg", pdfPage: 51, printedPage: 101 },
  structure: { standard: ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red"], special: ["Titanium Grey"] },
  swingArm: { standard: ["Piano Black", "Matte Graphite Black", "Light Grey", "Performance Red", "Hermès Orange", "Apple Green"], special: ["Titanium Grey", "Ocean Blue"] },
  upholstery: { standard: ["Black", "Saddle Brown", "Reddish Brown", "Mocha"], special: [] },
 },
 "dhz-sforce": {
  source: { title: "Hammer S-FORCE", asset: "/catalog/dhz-s-force-original-colors.jpeg", pdfPage: 29 },
  structure: { standard: ["Piano Black", "Graphite Black", "Light Grey", "Performance Red", "Titanium Grey"], special: [] },
  swingArm: { standard: ["Piano Black", "Graphite Black", "Light Grey", "Performance Red", "Hermès Orange", "Apple Green", "Ocean Blue"], special: ["Titanium Grey"] },
  upholstery: { standard: ["Black", "Saddle Brown", "Reddish Brown", "Khaki", "Mocha"], special: [] },
 },
}

export function getCatalogFinishPalette(value?: string | null): CatalogFinishDefinition | undefined {
 return value && Object.hasOwn(palettes, value) ? palettes[value as CatalogFinishPalette] : undefined
}

function colorKey(value: string, part: CatalogFinishPart) {
 const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "")
 // The supplier uses both graphite labels for paint; this does not translate generic fabrics or colors.
 return part !== "upholstery" && key === "mattegraphiteblack" ? "graphiteblack" : key
}

export function catalogFinishGroups(reference: string | null | undefined, part: CatalogFinishPart, available?: readonly string[] | null) {
 const options = [...(available ?? [])]
 const palette = getCatalogFinishPalette(reference)
 if (!palette) return { standard: [], special: [], other: options }
 const standard = new Set(palette[part].standard.map(name => colorKey(name, part)))
 const special = new Set(palette[part].special.map(name => colorKey(name, part)))
 return {
  standard: options.filter(name => standard.has(colorKey(name, part))),
  special: options.filter(name => !standard.has(colorKey(name, part)) && special.has(colorKey(name, part))),
  other: options.filter(name => !standard.has(colorKey(name, part)) && !special.has(colorKey(name, part))),
 }
}
