import Link from "next/link"
import { safeReturnTo } from "@/lib/return-to"
import { ArrowRight, Boxes, ShoppingCart, Users } from "lucide-react"
import { Suspense } from "react"
import { connection } from "next/server"
import { isErpLoginConfigured, WorkspaceAccessNotice } from "@/components/workspace-access"

type LoginProps = { searchParams: Promise<{ returnTo?: string | string[] }> }

export default function LoginPage({ searchParams }: LoginProps) {
  return <Suspense fallback={<p role="status">Preparando acesso…</p>}><LoginForm searchParams={searchParams} /></Suspense>
}

async function LoginForm({ searchParams }: LoginProps) {
  await connection()
  const returnTo = safeReturnTo((await searchParams).returnTo)
  const ready = isErpLoginConfigured()
  return <main className="min-h-dvh bg-background px-5 py-6 text-foreground sm:px-10">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4"><Link href="https://avilaops.com/erp" className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-primary font-bold text-primary-foreground">A</span><span><strong className="block">Ávila ERP</strong><span className="text-xs text-muted-foreground">Ávila Ops</span></span></Link><Link className="text-sm text-muted-foreground hover:text-foreground" href="https://avilaops.com/erp">Conhecer o ERP</Link></header>
    <div className="mx-auto grid max-w-6xl items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
      <section><p className="text-sm font-medium text-primary">Sua empresa, no mesmo lugar</p><h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Bem-vindo ao Ávila ERP</h1><p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Organize seus produtos, clientes e pedidos. Entre para acessar sua empresa ou crie sua conta para começar.</p><div className="mt-8 grid gap-4">{[[Boxes, "Produtos e estoque", "Mantenha seus cadastros e acompanhe as movimentações."], [ShoppingCart, "Compras e vendas", "Organize pedidos e os próximos passos da operação."], [Users, "Sua equipe", "Trabalhe com acessos definidos para cada pessoa."]].map(([Icon, title, text]) => { const Symbol = Icon as typeof Boxes; return <div key={String(title)} className="flex items-start gap-3"><Symbol className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="font-medium">{String(title)}</h2><p className="mt-1 text-sm text-muted-foreground">{String(text)}</p></div></div> })}</div></section>
      <section aria-labelledby="access-title" className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8"><h2 id="access-title" className="text-2xl font-semibold">Acesse sua empresa</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Use sua conta Ávila Ops. Depois de entrar, você poderá selecionar uma empresa ou cadastrar a sua.</p>
        {ready ? <div className="mt-7 space-y-4"><form action="/api/auth/login" method="get"><input type="hidden" name="returnTo" value={returnTo} /><button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground hover:opacity-90" type="submit">Entrar<ArrowRight className="size-4" aria-hidden="true" /></button></form><Link href={"/criar-conta?" + new URLSearchParams({ returnTo })} prefetch={false} className="flex min-h-12 w-full items-center justify-center rounded-xl border border-primary px-4 py-3 font-medium text-primary hover:bg-primary/5">Criar minha conta</Link><p className="text-xs leading-5 text-muted-foreground">Recebeu um convite? Entre com o mesmo e-mail informado no convite para acessar a empresa.</p></div> : <div className="mt-6"><WorkspaceAccessNotice state="configuration" /></div>}
      </section>
    </div><footer className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-3 border-t pt-5 text-xs text-muted-foreground"><span>Ávila Ops</span><Link href="https://avilaops.com/politica-de-privacidade">Privacidade</Link><Link href="https://avilaops.com/termos-de-servico">Termos de serviço</Link></footer>
  </main>
}

export const metadata = { title: "Entrar" }
