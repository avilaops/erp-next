import Link from "next/link"
import { Suspense } from "react"
import { CompanyWorkspace } from "@/features/company/company-workspace"
import {
  BadgeCheck,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileKey2,
  Fingerprint,
  Landmark,
  LockKeyhole,
  PackageSearch,
  PlugZap,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  WalletCards,
  Wrench,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"

const preferencesGroups = [
  {
    label: "Fundação",
    items: [
      { label: "Empresa", icon: Building2, active: true, href: "/preferencias/empresa" },
      { label: "Usuários e acessos", icon: Users, href: "/preferencias/usuarios" },
      { label: "Papéis e horários", icon: LockKeyhole, href: "/preferencias/papeis" },
      { label: "Sistema", icon: Settings2, href: "/preferencias/sistema" },
      { label: "Segurança e auditoria", icon: ShieldCheck, href: "/preferencias/seguranca" },
    ],
  },
  {
    label: "Operação",
    items: [
      { label: "Cadastros", icon: PackageSearch },
      { label: "Vendas", icon: ShoppingCart },
      { label: "Estoque e suprimentos", icon: Database },
      { label: "Financeiro", icon: WalletCards, href: "/preferencias/financeiro" },
      { label: "Fiscal", icon: ReceiptText, href: "/preferencias/fiscal" },
      { label: "Logística", icon: Truck },
      { label: "Serviços", icon: Wrench },
    ],
  },
  {
    label: "Conexões e dados",
    items: [
      { label: "Integrações", icon: PlugZap, href: "/preferencias/integracoes" },
      { label: "Certificado digital", icon: FileKey2, href: "/preferencias/certificado-digital" },
      { label: "Importação de dados", icon: Database, href: "/preferencias/dados/importacao" },
      { label: "Exportação de dados", icon: Database, href: "/preferencias/dados/exportacao" },
    ],
  },
]

const settingsGroups = [
  {
    title: "Identidade",
    description: "Informações que identificam a empresa em documentos e operações.",
    items: [
      { title: "Dados cadastrais", description: "Razão social, nome fantasia, CNPJ, porte e atividade", status: "Completo", icon: Building2 },
      { title: "Endereço", description: "Endereço fiscal e localização principal", status: "Completo", icon: Landmark },
      { title: "Contatos", description: "E-mails, telefones e responsáveis", status: "Revisar", icon: Users },
      { title: "Marca", description: "Logotipo e identidade usada nos documentos", status: "Completo", icon: BadgeCheck },
    ],
  },
  {
    title: "Fiscal",
    description: "Dados tributários e credenciais necessárias para a operação fiscal.",
    items: [
      { title: "Configuração tributária", description: "Regime tributário, CNAE, inscrições e SUFRAMA", status: "Revisar", icon: ReceiptText },
      { title: "Inscrições estaduais", description: "Substituição tributária por unidade federativa", status: "Pendente", icon: CircleDollarSign },
      { title: "Certificado digital", description: "Conexão, validade e substituição do certificado A1", status: "Gerenciar", icon: Fingerprint, href: "/preferencias/certificado-digital" },
    ],
  },
  {
    title: "Governança e conexões",
    description: "Controle de acesso, rastreabilidade e serviços conectados.",
    items: [
      { title: "Usuários e permissões", description: "Membros, papéis e acessos por empresa", status: "1 administrador", icon: LockKeyhole, href: "/preferencias/usuarios" },
      { title: "Integrações", description: "Canais, webhooks e estado das sincronizações", status: "Nenhuma ativa", icon: PlugZap, href: "/preferencias/integracoes" },
      { title: "Auditoria", description: "Histórico de alterações e eventos relevantes", status: "Ativa", icon: ShieldCheck, href: "/preferencias/seguranca" },
    ],
  },
]

function Status({ value }: { value: string }) {
  const tone = value === "Completo" || value === "Ativa" ? "success" : value === "Revisar" ? "warning" : "neutral"
  return <span className={`status-pill ${tone}`}>{value}</span>
}

export default function CompanyPreferencesPage() {
  return (
    <div className="mx-auto grid max-w-[1600px] gap-0 px-4 pb-24 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
      <aside className="hidden border-r border-border py-8 pr-5 lg:block" aria-label="Categorias de preferências">
        <div className="mb-6 flex items-center gap-2"><Settings2 className="size-5 text-primary" /><h2 className="text-lg font-semibold">Preferências</h2></div>
        <nav className="space-y-6">
          {preferencesGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = "active" in item && item.active
                  const content = <><Icon className="size-4" />{item.label}</>
                  return item.href
                    ? <Link className={`preferences-link ${isActive ? "is-active" : ""}`} href={item.href} key={item.label} aria-current={isActive ? "page" : undefined}>{content}</Link>
                    : <span className={`preferences-link ${isActive ? "is-active" : ""}`} key={item.label}>{content}</span>
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 py-8 lg:pl-8 xl:pl-12">
        <div className="mb-6 flex items-center justify-between gap-4 lg:hidden">
          <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm" type="button"><Settings2 className="size-4" />Preferências<ChevronRight className="size-4" /></button>
        </div>

        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <PageHeader eyebrow="Preferências / Empresa" title="Empresa" description="O núcleo da operação: identidade, configuração fiscal, acesso e conexões da empresa ativa." />
          <label className="mb-8 flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 xl:max-w-sm">
            <Search className="size-4 text-muted-foreground" /><span className="sr-only">Pesquisar nas preferências da empresa</span>
            <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Pesquisar nas configurações" type="search" />
          </label>
        </div>

        <Suspense fallback={<p role="status">Carregando empresa…</p>}><CompanyWorkspace summary /></Suspense>

        <div className="mt-8 space-y-8">
          {settingsGroups.map((group) => (
            <section key={group.title} aria-labelledby={`group-${group.title.replaceAll(" ", "-")}`}>
              <div className="mb-3"><h2 className="text-lg font-semibold" id={`group-${group.title.replaceAll(" ", "-")}`}>{group.title}</h2><p className="mt-1 text-sm text-muted-foreground">{group.description}</p></div>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const content = <><span className="settings-symbol"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{item.title}</strong><small className="mt-1 block text-sm text-muted-foreground">{item.description}</small></span><Status value={item.status} /><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></>
                  const href = item.title === "Dados cadastrais" ? "/preferencias/empresa/dados" : item.href
                  return href ? <Link className="settings-row" href={href} key={item.title}>{content}</Link> : <span className="settings-row" key={item.title}>{content}</span>
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
