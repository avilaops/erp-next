import { EventDetail } from "@/features/workspace/workspace-pages"

export function generateStaticParams() { return [{ id: "EVT-2026-013" }] }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EventDetail id={id} />
}

export const metadata = { title: "Detalhes de evento" }
