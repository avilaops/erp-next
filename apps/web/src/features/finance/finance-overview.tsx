import Link from "next/link"

import { PageHeader } from "@/components/page-header"

const available = [
  ["Contas a receber", "/financeiro/contas-receber", "Títulos originados de pedidos concluídos e recebimentos declarados."],
  ["Contas a pagar", "/financeiro/contas-pagar", "Obrigações de compras e folha, com pagamentos declarados e estornos."],
  ["Comissões", "/financeiro/comissoes", "Livro de comissões por vendedor, competência e pagamento declarado."],
  ["Contas financeiras", "/cadastros/contas-financeiras", "Cadastro de bancos, caixas e contas internas da empresa."],
  ["Categorias financeiras", "/cadastros/categorias-financeiras", "Classificação gerencial de receitas e despesas."],
  ["Formas de pagamento", "/cadastros/formas-pagamento", "Modalidades e prazos usados nas declarações financeiras."],
] as const

const unavailable = [
  ["Caixas e bancos", "/financeiro/caixas-bancos", "Saldo e lançamentos dependem de um ledger financeiro vinculado à conta."],
  ["Controle de caixa", "/financeiro/controle-caixa", "Abertura, movimentação e fechamento de caixa ainda não possuem persistência."],
  ["Remessas e retornos", "/financeiro/remessas-retornos", "CNAB exige arquivo, banco, carteira e reconciliação configurados."],
  ["Tributos", "/financeiro/tributos", "Apuração e pagamento exigem regras fiscais e integração oficial."],
] as const

function Card({ href, title, description, muted = false }: { href: string; title: string; description: string; muted?: boolean }) {
  return <Link href={href} className={`rounded-2xl border p-5 transition ${muted ? "border-dashed bg-muted/20 hover:border-amber-500/50" : "bg-card hover:border-primary/50 hover:bg-muted/20"}`}>
    <strong className="block font-semibold">{title}</strong>
    <span className="mt-2 block text-sm text-muted-foreground">{description}</span>
  </Link>
}

export function FinanceOverview() {
  return <main className="workspace-page-frame space-y-8">
    <PageHeader eyebrow="Financeiro" title="Financeiro" description="Operações financeiras da empresa ativa, com estados confirmados pelo servidor." />
    <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 text-sm text-muted-foreground">
      Recebimentos e pagamentos registrados no ERP são declarações manuais. Eles não transferem dinheiro nem comprovam liquidação bancária. Saldos de bancos e caixas só serão exibidos quando houver lançamentos vinculados a uma conta financeira.
    </section>
    <section className="space-y-4" aria-labelledby="financeiro-operacional">
      <h2 id="financeiro-operacional" className="text-xl font-semibold">Operações disponíveis</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{available.map(([title, href, description]) => <Card key={href} href={href} title={title} description={description} />)}</div>
    </section>
    <section className="space-y-4" aria-labelledby="financeiro-pendente">
      <h2 id="financeiro-pendente" className="text-xl font-semibold">Integrações pendentes</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{unavailable.map(([title, href, description]) => <Card key={href} href={href} title={title} description={description} muted />)}</div>
    </section>
  </main>
}
