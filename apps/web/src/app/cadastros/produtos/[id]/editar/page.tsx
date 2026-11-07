import { CatalogEditorLoading } from "@/features/catalog/catalog-loading"
import { CatalogAccess } from "@/features/catalog/catalog-access";
import { Suspense } from "react";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<CatalogEditorLoading title="Editar produto" />}><ResolvedProduct params={params} /></Suspense>;
}

async function ResolvedProduct({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogAccess editor id={id} />;
}

export const metadata = { title: "Editar produto" }
