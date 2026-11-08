import Link from "next/link";
import { PageTitle } from "@/components/workspace/page-title"

export function InventoryCapabilityUnavailable({
  eyebrow = "Estoque / Inventários",
  title = "Conferência de estoque",
  description = "O inventário físico ainda não possui contrato persistente nesta empresa.",
  requirement = "Nenhuma contagem, divergência ou ajuste será criado por esta tela até que o backend implemente sessão de inventário, contagem, aprovação e fechamento com auditoria.",
}: { eyebrow?: string; title?: string; description?: string; requirement?: string }) {
  return <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
    <header className="border-b border-border pb-7"><p className="text-sm font-medium text-primary">{eyebrow}</p><PageTitle className="mt-2 text-3xl font-semibold tracking-tight">{title}</PageTitle><p className="mt-3 max-w-2xl text-muted-foreground">{description}</p></header>
    <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6"><h2 className="text-lg font-semibold">Integração pendente</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{requirement}</p><Link className="mt-5 inline-flex text-sm font-medium text-primary hover:underline" href="/estoque">Voltar para Estoque</Link></section>
  </div>;
}
