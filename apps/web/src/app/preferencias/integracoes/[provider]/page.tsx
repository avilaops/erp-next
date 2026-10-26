import { Suspense } from "react"
import { notFound } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { IntegrationDetail } from "@/features/integrations/integration-detail"
import { integrations } from "@/features/integrations/integration-data"

export function generateStaticParams() { return integrations.map(({ provider }) => ({ provider })) }

export default function IntegrationDetailPage({ params }: PageProps<"/preferencias/integracoes/[provider]">) {
  return <Suspense fallback={<Skeleton className="mx-auto mt-12 h-96 max-w-5xl rounded-2xl" />}><ResolvedIntegration params={params} /></Suspense>
}

async function ResolvedIntegration({ params }: Pick<PageProps<"/preferencias/integracoes/[provider]">, "params">) {
  const { provider } = await params
  const integration = integrations.find((item) => item.provider === provider)
  if (!integration) notFound()
  return <IntegrationDetail integration={integration} />
}
