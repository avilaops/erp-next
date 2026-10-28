import { Suspense } from "react"
import { CatalogAccess } from "@/features/catalog/catalog-access"
export default function NewProductPage() { return <Suspense fallback={<p role="status">Carregando cadastro…</p>}><CatalogAccess editor /></Suspense> }
