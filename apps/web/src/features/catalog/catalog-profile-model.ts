export type CatalogSource = { title: string; url: string; pdfPage: number | null; printedPage: number | null }
export type CatalogProfileInput = {
  collection: string; muscleGroup: string; technicalCategory: string; dimensionsMm: number[]
  description: string; weight: string; weightStack: string; mainMediaId: string | null
  manufacturer: string; manufacturerModel: string; catalogProductName: string; liveArea: string
  catalogSources: CatalogSource[]
}
export type CatalogProfileData = CatalogProfileInput & { revision: number; publicPath: string }
export type CatalogAsset = { id: string; variant: string; version: number; width: number; height: number }
export type CatalogProfileSnapshot = { tenantId: string; productId?: string; canEdit: boolean; data: CatalogProfileData | null; assets: CatalogAsset[]; defaultCollection?: string; mediaConfigured?: boolean }

export function catalogProfileDraft(data: Partial<CatalogProfileData> | null, collection = "core"): CatalogProfileInput {
  return {
    collection: data?.collection || collection,
    muscleGroup: data?.muscleGroup || "", technicalCategory: data?.technicalCategory || "",
    dimensionsMm: data?.dimensionsMm?.slice(0, 3) || [0, 0, 0],
    description: data?.description || "", weight: data?.weight || "", weightStack: data?.weightStack || "",
    mainMediaId: data?.mainMediaId || null, manufacturer: data?.manufacturer || "",
    manufacturerModel: data?.manufacturerModel || "", catalogProductName: data?.catalogProductName || "",
    liveArea: data?.liveArea || "",
    catalogSources: (data?.catalogSources || []).map(source => ({ title: source.title, url: source.url, pdfPage: source.pdfPage ?? null, printedPage: source.printedPage ?? null })),
  }
}

export const sameCatalogProfile = (left: CatalogProfileInput, right: CatalogProfileInput) => JSON.stringify(left) === JSON.stringify(right)

export function catalogSourceLink(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? value : undefined } catch { return undefined }
}
