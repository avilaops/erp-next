import Image from "next/image"
import Link from "next/link"
import { ArrowRight, ArrowUpRight, Boxes, ShoppingCart, Users } from "lucide-react"
import { connection } from "next/server"
import { Suspense } from "react"
import { isErpLoginConfigured, WorkspaceAccessNotice } from "@/components/workspace-access"
import { safeReturnTo } from "@/lib/return-to"

type LoginProps = { searchParams: Promise<{ returnTo?: string | string[] }> }

const benefits = [
  { icon: Boxes, title: "Produtos e estoque", description: "Cada item, no seu lugar." },
  { icon: ShoppingCart, title: "Compras e vendas", description: "Do pedido ao próximo passo." },
  { icon: Users, title: "Sua equipe", description: "Cada pessoa, com seu acesso." },
]

export default function LoginPage({ searchParams }: LoginProps) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Preparando acesso…</p>}><LoginForm searchParams={searchParams} /></Suspense>
}

async function LoginForm({ searchParams }: LoginProps) {
  await connection()
  const returnTo = safeReturnTo((await searchParams).returnTo)
  const ready = isErpLoginConfigured()

  return (
    <div className="min-h-dvh bg-primary/[0.035] text-foreground dark:bg-background">
      <a href="#acesso" className="skip-link">Pular para o acesso</a>
      <div className="mx-auto max-w-7xl px-5 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between gap-4 py-5 sm:py-7">
          <Link href="https://avilaops.com/erp" className="flex min-h-11 items-center gap-3 rounded-lg">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">A</span>
            <span className="leading-tight"><strong className="block text-base tracking-tight">Ávila ERP</strong><span className="mt-1 block text-xs text-muted-foreground">Avila Ops</span></span>
          </Link>
          <Link href="https://avilaops.com/erp" className="flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Conhecer o ERP<ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </header>

        <main>
          <div className="grid items-center gap-10 pb-10 pt-7 sm:gap-12 sm:pb-14 sm:pt-12 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:pb-16 lg:pt-14">
            <section aria-labelledby="welcome-title" className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                <span aria-hidden="true" className="h-px w-6 bg-primary" />Sua empresa, conectada
              </p>
              <h1 id="welcome-title" className="mt-4 max-w-lg text-[2.75rem] font-semibold leading-[1.06] tracking-[-0.045em] sm:text-6xl lg:text-[4.25rem]">
                Sua operação,<br /><span className="text-primary">sob controle.</span>
              </h1>
              <p className="mt-5 max-w-sm text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Produtos, vendas e financeiro.<br />Tudo no mesmo lugar, com a sua equipe.
              </p>

              <section id="acesso" aria-labelledby="access-title" className="mt-7 scroll-mt-5 rounded-2xl focus-visible:outline-2 focus-visible:outline-primary sm:mt-9" tabIndex={-1}>
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

            <figure className="min-w-0 overflow-hidden rounded-[1.75rem] bg-[#134e4a] px-5 pb-5 pt-6 text-white sm:px-7 sm:pb-7 sm:pt-8 lg:rounded-[2rem] lg:pt-10">
              <figcaption>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-teal-200">Menos dispersão. Mais gestão.</p>
                <h2 className="mt-3 text-2xl font-medium leading-tight tracking-tight sm:text-3xl">O seu dia a dia,<br />com uma visão mais clara.</h2>
              </figcaption>
              <div className="mt-6 overflow-hidden rounded-xl border border-white/20 bg-white shadow-2xl shadow-black/20 sm:mt-8">
                <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-stone-200 bg-stone-50 px-3 py-2.5">
                  <span className="size-1.5 rounded-full bg-stone-300" /><span className="size-1.5 rounded-full bg-stone-300" /><span className="size-1.5 rounded-full bg-stone-300" />
                  <span className="ml-2 text-[10px] text-stone-500">erp.avilaops.com</span>
                </div>
                <Image src="/erp-preview.webp" alt="Tela de produtos do Ávila ERP, com busca, filtros e catálogo de itens de demonstração." width={1120} height={760} sizes="(min-width: 1280px) 530px, (min-width: 1024px) 45vw, (min-width: 640px) 80vw, 90vw" className="h-auto w-full" />
              </div>
              <p className="mt-3 text-xs leading-5 text-teal-100">Interface do ERP · Dados demonstrativos</p>
            </figure>
          </div>

          <section aria-label="No seu dia a dia" className="grid gap-5 border-y border-primary/10 py-6 sm:grid-cols-3 sm:gap-6 sm:py-7">
            {benefits.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/10 bg-primary/5 text-primary"><Icon aria-hidden="true" className="size-5" /></span>
                <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
              </div>
            ))}
          </section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 text-xs text-muted-foreground">
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
