import { CatalogEditorLoading } from "@/features/catalog/catalog-loading"
import { Suspense } from "react"
import { CatalogAccess } from "@/features/catalog/catalog-access"
export default function NewProductPage() { return <Suspense fallback={<CatalogEditorLoading title="Novo produto" />}><CatalogAccess editor /></Suspense> }

export const metadata = { title: "Novo produto" }
