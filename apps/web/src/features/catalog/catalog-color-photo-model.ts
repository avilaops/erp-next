/** Pixel rectangles in the unmodified manufacturer raster; see public/catalog provenance. */
const photos = [
  { name: "Piano Black", x: 71, y: 939, width: 90, height: 62 },
  { name: "Matte Graphite Black", x: 172, y: 939, width: 90, height: 62 },
  { name: "Light Grey", x: 273, y: 939, width: 90, height: 62 },
  { name: "Performance Red", x: 374, y: 939, width: 90, height: 62 },
  { name: "Titanium Grey", x: 75, y: 174, width: 92, height: 64 },
  { name: "Hermès Orange", x: 971, y: 939, width: 90, height: 62 },
  { name: "Apple Green", x: 1072, y: 939, width: 90, height: 62 },
  { name: "Ocean Blue", x: 75, y: 263, width: 92, height: 63 },
  { name: "Saddle Brown", x: 510, y: 1695, width: 180, height: 62 },
  { name: "Reddish Brown", x: 760, y: 1695, width: 180, height: 62 },
  { name: "Mocha", x: 1010, y: 1695, width: 180, height: 62 },
] as const

function key(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "")
}

export type CatalogPalette = "dhz-hammerforce"

export function catalogPaletteFor(structureColors?: readonly string[] | null): CatalogPalette | undefined {
  const colors = new Set((structureColors ?? []).map(key))
  return colors.has("pianoblack") && colors.has("titaniumgrey") && (colors.has("graphiteblack") || colors.has("mattegraphiteblack")) ? "dhz-hammerforce" : undefined
}

const hammerForceAliases: Record<string, string> = {
  preto: "Piano Black",
  grafite: "Matte Graphite Black",
  cinza: "Light Grey",
  vermelho: "Performance Red",
  laranja: "Hermès Orange",
  azul: "Ocean Blue",
}

export function catalogColorPhoto(value: string, palette?: CatalogPalette) {
  // Resolve legacy swing-arm labels only after the same product identifies its palette.
  const aliasKey = key(value)
  const alias = palette === "dhz-hammerforce" && Object.hasOwn(hammerForceAliases, aliasKey) ? hammerForceAliases[aliasKey] : undefined
  const normalized = key(alias ?? value)
  // The supplier's shortened label refers to the same named graphite finish.
  return photos.find(photo => key(photo.name) === normalized || (photo.name === "Matte Graphite Black" && normalized === "graphiteblack"))
}
