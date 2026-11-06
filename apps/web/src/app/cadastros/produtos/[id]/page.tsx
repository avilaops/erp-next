import { CatalogEditorLoading } from "@/features/catalog/catalog-loading"
import { CatalogAccess } from "@/features/catalog/catalog-access";
import { Suspense } from "react";

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<CatalogEditorLoading title="Produto" />}><ResolvedProduct params={params} /></Suspense>;
}

async function ResolvedProduct({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogAccess editor id={id} view />;
}

export const metadata = { title: "Detalhes de produto" }
