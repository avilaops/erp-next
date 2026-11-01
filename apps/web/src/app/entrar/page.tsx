import Link from "next/link"
import { ArrowRight, ArrowUpRight, Boxes, ShoppingCart, Users } from "lucide-react"
import { connection } from "next/server"
import { Suspense } from "react"
import { ErpEntryPreview } from "@/components/erp-entry-preview"
import { isErpLoginConfigured, WorkspaceAccessNotice } from "@/components/workspace-access"
import { safeReturnTo } from "@/lib/return-to"
import "./entrar.css"

type LoginProps = { searchParams: Promise<{ returnTo?: string | string[]; erro?: string | string[] }> }

const benefits = [
  { icon: Boxes, title: "Produtos e estoque", description: "Catálogo, saldos e movimentações." },
  { icon: ShoppingCart, title: "Compras e vendas", description: "Pedidos e próximos passos da operação." },
  { icon: Users, title: "Sua equipe", description: "Acessos definidos para cada pessoa." },
]

export default function LoginPage({ searchParams }: LoginProps) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando acesso…</p>}><LoginForm searchParams={searchParams} /></Suspense>
}

async function LoginForm({ searchParams }: LoginProps) {
  await connection()
  const params = await searchParams
  const returnTo = safeReturnTo(params.returnTo)
  const errorMessage = params.erro === "restart"
    ? "Não foi possível validar esta tentativa de acesso. Ela pode ter expirado ou sido aberta em outro navegador. Clique em Entrar para começar novamente."
    : params.erro === "denied"
      ? "Não foi possível confirmar o acesso desta conta. Confira se está usando o e-mail do convite e, se necessário, fale com quem administra a empresa."
      : params.erro === "unavailable"
        ? "Não foi possível concluir o acesso agora. Tente entrar novamente em instantes."
        : null
  const ready = isErpLoginConfigured()

  return (
    <div className="min-h-dvh bg-primary/[0.035] text-foreground dark:bg-background lg:flex lg:flex-col lg:justify-center">
      <a href="#acesso" className="skip-link">Pular para o acesso</a>
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-10 lg:px-12">
        <header className="erp-entry-header flex items-center justify-between gap-4 border-b border-primary/10 py-5 sm:py-6">
          <Link href="https://avilaops.com/erp" className="flex min-h-11 items-center gap-3 rounded-lg">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">A</span>
            <span className="leading-tight"><strong className="block text-base tracking-tight">Ávila ERP</strong><span className="mt-1 block text-xs text-muted-foreground">Avila Ops</span></span>
          </Link>
          <Link href="https://avilaops.com/erp" className="flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Conhecer o ERP<ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </header>

        <main>
          {errorMessage && <p role="alert" className="mt-6 rounded-xl border border-border bg-card p-4 text-sm leading-6">{errorMessage}</p>}
          <div className="erp-entry-hero grid items-center gap-8 pb-8 pt-7 sm:gap-10 sm:py-10 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:py-8">
            <section aria-labelledby="welcome-title" className="erp-entry-welcome min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                <span aria-hidden="true" className="h-px w-6 bg-primary" />Sua empresa, conectada
              </p>
              <h1 id="welcome-title" className="erp-entry-title mt-4 max-w-lg text-[clamp(2.25rem,11vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.045em] sm:text-6xl lg:text-[clamp(3rem,4.6vw,4rem)]">
                Sua operação,<br /><span className="text-primary">sob controle.</span>
              </h1>
              <p className="erp-entry-description mt-5 max-w-sm text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Produtos, vendas e financeiro.<br />Tudo no mesmo lugar, com a sua equipe.
              </p>

              <section id="acesso" aria-labelledby="access-title" className="erp-entry-access mt-7 scroll-mt-5 rounded-2xl focus-visible:outline-2 focus-visible:outline-primary sm:mt-9" tabIndex={-1}>
                <h2 id="access-title" className="text-sm font-medium">Acesse com sua conta Ávila Ops</h2>
                {ready ? <>
                  <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
                    <form action="/api/auth/login" method="get">
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button type="submit" className="group flex min-h-13 w-full items-center justify-center gap-3 rounded-xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
                        Entrar<ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" />
                      </button>
                    </form>
                    <Link href={"/criar-conta?" + new URLSearchParams({ returnTo })} prefetch={false} className="flex min-h-13 items-center justify-center rounded-xl border border-primary/30 bg-background px-5 py-3 text-base font-semibold text-primary transition-colors hover:bg-accent">
                      Criar minha conta
                    </Link>
                  </div>
                  <p className="mt-3 max-w-sm text-xs leading-5 text-muted-foreground">Recebeu um convite? Entre com o e-mail convidado.</p>
                </> : <div className="mt-3 max-w-md"><WorkspaceAccessNotice state="configuration" /></div>}
              </section>
            </section>

            <figure className="min-w-0 overflow-hidden rounded-[1.75rem] bg-[#134e4a] p-5 text-white sm:p-6 lg:rounded-[2rem]">
              <figcaption>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-teal-200">Por dentro do ERP</p>
                <h2 className="mt-3 max-w-sm text-2xl font-medium leading-tight tracking-tight sm:text-[1.75rem]">Uma visão clara da sua operação.</h2>
              </figcaption>
              <ErpEntryPreview />
              <p className="mt-3 text-xs leading-5 text-teal-100">Interface real · Dados demonstrativos</p>
            </figure>
          </div>

          <section aria-label="No seu dia a dia" className="grid divide-y divide-primary/10 rounded-2xl border border-primary/10 bg-background/70 px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-0">
            {benefits.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-center gap-3 py-4 sm:px-5 sm:py-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/5 text-primary"><Icon aria-hidden="true" className="size-5" /></span>
                <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
              </div>
            ))}
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-xs text-muted-foreground">
          <span>Avila Ops</span>
          <nav aria-label="Informações legais" className="flex flex-wrap gap-x-5">
            <Link href="https://avilaops.com/politica-de-privacidade" className="inline-flex min-h-11 items-center rounded-md hover:text-primary">Privacidade</Link>
            <Link href="https://avilaops.com/termos-de-servico" className="inline-flex min-h-11 items-center rounded-md hover:text-primary">Termos de serviço</Link>
          </nav>
        </footer>
      </div>
    </div>
  )
}

export const metadata = { title: "Entrar" }
