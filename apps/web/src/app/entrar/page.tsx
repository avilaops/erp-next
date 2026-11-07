import { Suspense } from "react"
import { connection } from "next/server"
import { AuthPage } from "@/features/access/auth-page"
import { isErpLoginConfigured } from "@/features/access/workspace-access"
import { safeReturnTo } from "@/lib/return-to"
import "./entrar.css"

type LoginProps = { searchParams: Promise<{ returnTo?: string | string[]; erro?: string | string[] }> }

export default function LoginPage({ searchParams }: LoginProps) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando acesso…</p>}><LoginForm searchParams={searchParams} /></Suspense>
}

async function LoginForm({ searchParams }: LoginProps) {
  await connection()
  const params = await searchParams
  const returnTo = safeReturnTo(params.returnTo)
  const errors: Record<string, string> = {
    restart: "Sua tentativa de acesso expirou. Entre novamente para continuar.",
    denied: "Não foi possível verificar seu acesso. Confira sua conta e tente novamente.",
    unavailable: "Não foi possível concluir o acesso. O serviço está temporariamente indisponível. Tente novamente.",
  }
  const error = typeof params.erro === "string" && Object.hasOwn(errors, params.erro) ? errors[params.erro] : undefined
  return <AuthPage loginHref={"/api/auth/login?" + new URLSearchParams({ returnTo })} ready={isErpLoginConfigured()} error={error} />
}

export async function generateMetadata() {
  return { metadataBase: new URL(process.env.ERP_WEB_ORIGIN || "https://erp.avilaops.com"), title: "Avila ERP · Acesse sua operação", description: "Acesse o espaço da sua empresa no Avila ERP.", openGraph: { title: "Avila ERP · Acesse sua operação", images: [{ url: "/erp-social.png", width: 1200, height: 630, alt: "Avila ERP" }] } }
}
