import Link from "next/link"
import {
  ArrowRight,
  Boxes,
  Building2,
  CreditCard,
  FolderTree,
  Landmark,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

type RecordModule = {
  href: string
  title: string
  description: string
  icon: LucideIcon
}

const recordModules: RecordModule[] = [
  { href: "/cadastros/produtos", title: "Produtos", description: "SKU, unidade, preço base e classificação declarada", icon: Boxes },
  { href: "/cadastros/clientes-fornecedores", title: "Clientes e fornecedores", description: "Identificação, papéis comerciais e contatos", icon: Building2 },
  { href: "/cadastros/funcionarios", title: "Funcionários", description: "Cadastro operacional e contatos da equipe", icon: UsersRound },
  { href: "/cadastros/contas-financeiras", title: "Contas financeiras", description: "Bancos, caixas e contas internas", icon: Landmark },
  { href: "/cadastros/categorias-financeiras", title: "Categorias financeiras", description: "Classificação de receitas e despesas", icon: Tags },
  { href: "/cadastros/formas-pagamento", title: "Formas de pagamento", description: "Pix, dinheiro, cartões e boletos", icon: CreditCard },
  { href: "/cadastros/categorias-produtos", title: "Categorias de produtos", description: "Hierarquia e organização do catálogo", icon: FolderTree },
  { href: "/cadastros/listas-precos", title: "Listas de preços", description: "Vigências e regras por canal ou cliente", icon: WalletCards },
]

export function RecordsOverview() {
  return (
    <div className="workspace-page-frame">

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Áreas de cadastros">
        {recordModules.map(({ href, title, description, icon: Icon }) => (
          <Link className="group rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30" href={href} key={href}>
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <div className="mt-5 flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <strong className="block text-base">{title}</strong>
                <small className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</small>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Cadastro conectado · consulta exige acesso à empresa</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
