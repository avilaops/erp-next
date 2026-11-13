import { getCatalogFinishPalette, type CatalogFinishPalette, type CatalogFinishPart } from "./catalog-finish-palettes.ts"

/** Pixel rectangles in the unmodified manufacturer rasters; see public/catalog provenance. */
const proPhotos = [
  { name: "Piano Black", x: 71, y: 939, width: 90, height: 62 },
  { name: "Matte Graphite Black", x: 172, y: 939, width: 90, height: 62 },
  { name: "Light Grey", x: 273, y: 939, width: 90, height: 62 },
  { name: "Performance Red", x: 374, y: 939, width: 90, height: 62 },
  { name: "Titanium Grey", x: 75, y: 174, width: 92, height: 64 },
  { name: "Hermès Orange", x: 971, y: 939, width: 90, height: 62 },
  { name: "Apple Green", x: 1072, y: 939, width: 90, height: 62 },
  { name: "Ocean Blue", x: 75, y: 263, width: 92, height: 63 },
  { name: "Black", x: 260, y: 1695, width: 180, height: 62 },
  { name: "Saddle Brown", x: 510, y: 1695, width: 180, height: 62 },
  { name: "Reddish Brown", x: 760, y: 1695, width: 180, height: 62 },
  { name: "Mocha", x: 1010, y: 1695, width: 180, height: 62 },
] as const

const sforcePhotos = [
  { name: "Piano Black", x: 71, y: 117, width: 90, height: 64 },
  { name: "Graphite Black", x: 172, y: 117, width: 90, height: 64 },
  { name: "Light Grey", x: 273, y: 117, width: 90, height: 64 },
  { name: "Performance Red", x: 374, y: 117, width: 90, height: 64 },
  { name: "Titanium Grey", x: 475, y: 117, width: 90, height: 64 },
  { name: "Hermès Orange", x: 475, y: 328, width: 90, height: 62 },
  { name: "Apple Green", x: 576, y: 328, width: 90, height: 62 },
  { name: "Ocean Blue", x: 678, y: 328, width: 90, height: 62 },
  { name: "Black", x: 240, y: 1695, width: 150, height: 62 },
  { name: "Saddle Brown", x: 440, y: 1695, width: 150, height: 62 },
  { name: "Reddish Brown", x: 650, y: 1695, width: 150, height: 62 },
  { name: "Khaki", x: 850, y: 1695, width: 150, height: 62 },
  { name: "Mocha", x: 1060, y: 1695, width: 150, height: 62 },
] as const

function key(value: string, part: CatalogFinishPart) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "")
  return part !== "upholstery" && normalized === "mattegraphiteblack" ? "graphiteblack" : normalized
}

export type CatalogPalette = CatalogFinishPalette

export function catalogPaletteFor(reference: unknown): CatalogPalette | undefined {
  return typeof reference === "string" && getCatalogFinishPalette(reference) ? reference as CatalogPalette : undefined
}

export function catalogColorPhoto(value: string, reference?: CatalogPalette, part: CatalogFinishPart = "structure") {
  const palette = getCatalogFinishPalette(reference)
  if (!palette) return undefined
  const normalized = key(value, part)
  if (![...palette[part].standard, ...palette[part].special].some(name => key(name, part) === normalized)) return undefined
  const photos = reference === "dhz-sforce" ? sforcePhotos : proPhotos
  const photo = photos.find(photo => key(photo.name, part) === normalized)
  return photo ? { ...photo, asset: palette.source.asset, sourceWidth: 1245, sourceHeight: 1759 } : undefined
}
