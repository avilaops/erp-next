"use client"

import { useState, type ReactNode } from "react"
import { BadgeCheck, Building2, ChevronRight, CircleDollarSign, Fingerprint, Landmark, LockKeyhole, PlugZap, ReceiptText, Search, Settings2, ShieldCheck, Users } from "lucide-react"
import { GuardedLink as Link } from "@/components/navigation-guard"
import { preferenceGroups } from "@/components/navigation-catalog"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useCompanyProfile } from "./company-profile-context"
import { companySectionStatus, type CompanySection } from "./company-sections"

const settingsGroups = [
  { title: "Identidade", description: "Informações que identificam a empresa em documentos e operações.", items: [
    { title: "Dados cadastrais", description: "Razão social, nome fantasia e CPF ou CNPJ", icon: Building2, href: "/preferencias/empresa/dados?secao=identificacao", section: "identificacao" },
    { title: "Endereço", description: "Endereço fiscal e localização principal", icon: Landmark, href: "/preferencias/empresa/dados?secao=endereco", section: "endereco" },
    { title: "Contatos", description: "E-mails, telefones e responsáveis", icon: Users, href: "/preferencias/empresa/dados?secao=contato", section: "contato" },
    { title: "Marca", description: "Configuração de logotipo e identidade ainda indisponível nesta tela", icon: BadgeCheck, href: null },
  ] },
  { title: "Fiscal", description: "Dados tributários e credenciais necessárias para a operação fiscal.", items: [
    { title: "Configuração tributária", description: "Regime tributário, CNAE, inscrições e SUFRAMA", icon: ReceiptText, href: "/preferencias/empresa/dados?secao=fiscal", section: "fiscal" },
    { title: "Inscrições estaduais", description: "Inscrições estaduais substitutas por unidade federativa", icon: CircleDollarSign, href: "/preferencias/empresa/dados?secao=inscricoes", section: "inscricoes" },
    { title: "Certificado digital", description: "Conexão, validade e substituição do certificado A1", icon: Fingerprint, href: "/preferencias/certificado-digital" },
  ] },
  { title: "Governança e conexões", description: "Controle de acesso, rastreabilidade e serviços conectados.", items: [
    { title: "Usuários e permissões", description: "Membros, papéis e acessos por empresa", icon: LockKeyhole, href: "/preferencias/usuarios" },
    { title: "Integrações", description: "Canais, webhooks e estado das sincronizações", icon: PlugZap, href: "/preferencias/integracoes" },
    { title: "Auditoria", description: "Histórico de alterações e eventos relevantes", icon: ShieldCheck, href: "/preferencias/seguranca" },
  ] },
]

function normalize(value: string) { return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim() }

function PreferenceLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <nav className="space-y-6" aria-label="Categorias de preferências">{preferenceGroups.map(group => <div key={group.label}>
    <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
    <div className="space-y-1">{group.items.map(item => <Link key={item.href} href={item.href} onNavigate={onNavigate}
      className={`preferences-link ${item.href === "/preferencias/empresa" ? "is-active" : ""}`} aria-current={item.href === "/preferencias/empresa" ? "page" : undefined}>{item.label}</Link>)}</div>
  </div>)}</nav>
}

export function CompanyPreferences({ summary }: { summary: ReactNode }) {
  const { company } = useCompanyProfile()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const search = normalize(query)
  const groups = settingsGroups.map(group => ({ ...group, items: group.items.filter(item => normalize(`${group.title} ${item.title} ${item.description}`).includes(search)) })).filter(group => group.items.length)
  return <div className="mx-auto grid max-w-[1600px] gap-0 px-4 pb-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
    <aside className="hidden border-r border-border py-8 pr-5 lg:block"><div className="mb-6 flex items-center gap-2"><Settings2 className="size-5 text-primary" /><h2 className="text-lg font-semibold">Preferências</h2></div><PreferenceLinks /></aside>
    <div className="min-w-0 py-8 lg:pl-8 xl:pl-12">
      <div className="mb-6 lg:hidden"><Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" />}><Settings2 />Preferências<ChevronRight /></DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Preferências</DialogTitle><DialogDescription>Acesse as configurações do ERP.</DialogDescription></DialogHeader><PreferenceLinks onNavigate={() => setOpen(false)} /></DialogContent>
      </Dialog></div>
      <Link href="/preferencias" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-primary hover:underline"><ChevronRight className="size-4 rotate-180" aria-hidden="true" />Todas as preferências</Link>
      <PageHeader eyebrow="Preferências / Empresa" title="Empresa" description="Identidade, configuração fiscal, acesso e conexões da empresa ativa." />
      <div className="mb-6 flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">Pesquisar nas preferências da empresa</span>
          <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Pesquisar nas configurações" type="search" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        {query && <Button variant="outline" onClick={() => setQuery("")} aria-label="Limpar pesquisa">Limpar</Button>}
      </div>
      {summary}
      <p className="mt-6 text-sm text-muted-foreground">Os indicadores mostram somente o preenchimento do cadastro carregado. Não comprovam validação fiscal, autorização de notas ou conexão com serviços externos.</p>
      <p className="sr-only" role="status">{groups.reduce((total, group) => total + group.items.length, 0)} configurações encontradas.</p>
      <div className="mt-6 space-y-8">
        {!groups.length && <p role="status">Nenhuma configuração encontrada.</p>}
        {groups.map((group, index) => <section key={group.title} aria-labelledby={`company-settings-${index}`}>
          <div className="mb-3"><h2 className="text-lg font-semibold" id={`company-settings-${index}`}>{group.title}</h2><p className="mt-1 text-sm text-muted-foreground">{group.description}</p></div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">{group.items.map(item => {
            const Icon = item.icon
            const status = !item.href ? "Indisponível" : "section" in item && item.section && company ? companySectionStatus(company.data, item.section as CompanySection) : "Não verificado"
            const content = <><span className="settings-symbol"><Icon className="size-5" aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{item.title}</strong><span className="mt-1 block text-sm text-muted-foreground">{item.description}</span><span className="mt-1 block text-xs text-muted-foreground">{status}</span></span>{item.href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}</>
            return item.href ? <Link className="settings-row" href={item.href} key={item.title}>{content}</Link> : <div className="flex min-h-20 items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 sm:px-5" key={item.title}>{content}</div>
          })}</div>
        </section>)}
      </div>
    </div>
  </div>
}
