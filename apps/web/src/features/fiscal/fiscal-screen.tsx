import Link from "next/link"
import {
  FileText,
  Landmark,
  MonitorCheck,
  ReceiptText,
} from "lucide-react"
import { NfeDrafts } from "./nfe-drafts"
import { PageHeader } from "@/components/page-header"

type Kind = "overview" | "nfce" | "guides"

const shortcuts = [
  ["Notas recebidas e importação de XML", "/fiscal/monitor", "Consultar documentos recebidos", MonitorCheck],
  ["CT-e recebidos", "/fiscal/ctes", "Consultar distribuição de CT-e", FileText],
  ["NFS-e recebidas", "/fiscal/nfses", "Consultar documentos recebidos", FileText],
  ["Configurações fiscais", "/preferencias/fiscal", "Configurar empresa ativa", FileText],
  ["DANFE de XML autorizado", "/fiscal/danfe", "Baixar DANFE a partir de XML", ReceiptText],
  ["Notas fiscais de saída", "/fiscal/notas-saida", "Preparar e consultar NF-e", FileText],
  ["NFC-e", "/fiscal/nfce", "Preparar NFC-e modelo 65", ReceiptText],
  ["Guias tributárias", "/fiscal/guias", "Capacidade ainda indisponível", Landmark],
] as const

export function FiscalScreen({ kind }: { kind: Kind }) {
  if (kind === "nfce") return <NfeDrafts model={65} />
  if (kind === "guides") return <FiscalCapabilityUnavailable />
  return <FiscalOverview />
}

export function FiscalCapabilityUnavailable() {
  return (
    <Shell title="Guias tributárias" description="GNRE, DARE-SP e DAS ainda não possuem cálculo, emissão ou persistência fiscal neste ERP." back="/fiscal">
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Integração fiscal pendente</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Esta capacidade permanece indisponível até existir contrato de backend,
          regras por tributo e UF, permissões, cálculo verificável e integração
          oficial. Nenhuma guia será calculada, emitida ou marcada como paga por
          esta tela.
        </p>
      </section>
    </Shell>
  )
}

function FiscalOverview() {
  return (
    <Shell title="Fiscal" description="Configurações e documentos fiscais da empresa ativa.">
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Importe XMLs recebidos, consulte documentos armazenados e prepare
        documentos fiscais. A transmissão depende da configuração fiscal, do
        ambiente autorizado e da prontidão do emitente.
      </p>
      <nav className="mt-7 grid gap-3 sm:grid-cols-2" aria-label="Áreas fiscais">
        {shortcuts.map(([label, href, description, Icon]) => (
          <Link className="rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30" href={href} key={href}>
            <Icon className="size-5 text-primary" />
            <strong className="mt-4 block">{label}</strong>
            <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
          </Link>
        ))}
      </nav>
    </Shell>
  )
}

function Shell({
  title,
  description,
  back,
  children,
}: {
  title: string
  description: string
  back?: string
  children: React.ReactNode
}) {
  return (
    <div className="workspace-page-frame">
      {back && <Link className="mb-5 inline-flex text-sm text-muted-foreground hover:text-foreground" href={back}>← Fiscal</Link>}
      <PageHeader eyebrow="Fiscal" title={title} description={description} />
      <div className="mt-7">{children}</div>
    </div>
  )
}
