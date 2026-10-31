import { Suspense } from "react"
import { PostingDetail } from "@/features/logistics/logistics-details";

export function generateStaticParams() {
  return [{ id: "OBJ-2481" }];
}

async function ResolvedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostingDetail id={id} />;
}

export const metadata = { title: "Detalhes da postagem" }

export default function Page(props: Parameters<typeof ResolvedPage>[0]) {
  return <Suspense fallback={<p role="status" className="p-6">Carregando tela…</p>}><ResolvedPage {...props} /></Suspense>
}
