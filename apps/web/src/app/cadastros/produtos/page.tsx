import { Suspense } from "react"
import { CatalogAccess } from "@/features/catalog/catalog-access"
export default function ProductsPage() { return <Suspense fallback={<p role="status">Carregando catálogo…</p>}><CatalogAccess /></Suspense> }
