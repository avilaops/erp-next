"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Calculator,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type State = "ready" | "loading" | "empty" | "error" | "forbidden";
type Tone = "success" | "warning" | "danger" | "neutral";
type Row = {
  id: string;
  title: string;
  detail: string;
  amount: string;
  status: string;
  tone: Tone;
  due: string;
};
type Config = {
  title: string;
  description: string;
  action: string;
  filters: string[];
  rows: Row[];
};

const payable: Row[] = [
  {
    id: "CP-2841",
    title: "Aço Forte Distribuidora",
    detail: "Matéria-prima · Boleto",
    amount: "R$ 18.940,00",
    status: "A vencer",
    tone: "warning",
    due: "28 out 2026",
  },
  {
    id: "CP-2839",
    title: "Energia Industrial",
    detail: "Energia · Débito",
    amount: "R$ 4.382,19",
    status: "Pago",
    tone: "success",
    due: "24 out 2026",
  },
  {
    id: "CP-2827",
    title: "Transportes Norte",
    detail: "Frete · Pix",
    amount: "R$ 2.190,00",
    status: "Vencido",
    tone: "danger",
    due: "20 out 2026",
  },
];
const receivable: Row[] = [
  {
    id: "CR-7124",
    title: "Academia Horizonte",
    detail: "Pedido PV-1048 · Boleto",
    amount: "R$ 18.490,00",
    status: "A vencer",
    tone: "warning",
    due: "02 nov 2026",
  },
  {
    id: "CR-7118",
    title: "Studio Força Total",
    detail: "Pedido PV-1047 · Pix",
    amount: "R$ 7.240,00",
    status: "Recebido",
    tone: "success",
    due: "24 out 2026",
  },
  {
    id: "CR-7082",
    title: "Centro Esportivo Atlas",
    detail: "Parcela 2/3",
    amount: "R$ 10.626,67",
    status: "Em atraso",
    tone: "danger",
    due: "18 out 2026",
  },
];

const configs: Record<string, Config> = {
  "caixas-bancos": {
    title: "Caixas e bancos",
    description:
      "Consulte contas, caixas e movimentos demonstrativos por empresa.",
    action: "Nova conta",
    filters: ["Todas", "Ativa", "Inativa"],
    rows: [
      {
        id: "CTA-01",
        title: "Banco empresarial",
        detail: "Conta corrente · final 4821",
        amount: "R$ 128.430,12",
        status: "Ativa",
        tone: "success",
        due: "Atualizado há 12 min",
      },
      {
        id: "CTA-02",
        title: "Caixa da fábrica",
        detail: "Conta interna",
        amount: "R$ 3.840,00",
        status: "Ativa",
        tone: "success",
        due: "Atualizado hoje",
      },
      {
        id: "CTA-03",
        title: "Conta de homologação",
        detail: "Sem conexão bancária",
        amount: "—",
        status: "Inativa",
        tone: "neutral",
        due: "Sem atualização",
      },
    ],
  },
  "contas-pagar": {
    title: "Contas a pagar",
    description:
      "Obrigações, vencimentos e pagamentos locais para validação da interface.",
    action: "Nova obrigação",
    filters: ["Todas", "A vencer", "Pago", "Vencido"],
    rows: payable,
  },
  "contas-receber": {
    title: "Contas a receber",
    description:
      "Recebíveis, baixas e inadimplência sem movimentação financeira real.",
    action: "Novo recebível",
    filters: ["Todas", "A vencer", "Recebido", "Em atraso"],
    rows: receivable,
  },
  "remessas-retornos": {
    title: "Remessas e retornos",
    description:
      "Arquivos bancários demonstrativos; nenhum CNAB é transmitido ou processado.",
    action: "Preparar remessa",
    filters: ["Todos", "Preparado", "Validado", "Com erro"],
    rows: [
      {
        id: "REM-184",
        title: "Cobranças Banco empresarial",
        detail: "42 títulos · CNAB demonstrativo",
        amount: "R$ 94.880,00",
        status: "Preparado",
        tone: "warning",
        due: "Hoje, 09:10",
      },
      {
        id: "RET-092",
        title: "Retorno local de validação",
        detail: "38 ocorrências simuladas",
        amount: "R$ 72.340,00",
        status: "Validado",
        tone: "success",
        due: "Ontem, 17:42",
      },
    ],
  },
  "ficha-financeira": {
    title: "Ficha financeira",
    description:
      "Histórico consolidado demonstrativo por cliente ou fornecedor.",
    action: "Selecionar pessoa",
    filters: ["Todos", "Cliente", "Fornecedor"],
    rows: [...receivable.slice(0, 2), ...payable.slice(0, 2)],
  },
  comissoes: {
    title: "Comissões",
    description: "Cálculo, aprovação e liquidação simulados por vendedor.",
    action: "Calcular período",
    filters: ["Todas", "Calculada", "Aprovada", "Paga"],
    rows: [
      {
        id: "COM-221",
        title: "Mariana Costa",
        detail: "12 vendas elegíveis · 3,0%",
        amount: "R$ 4.218,90",
        status: "Calculada",
        tone: "warning",
        due: "Outubro 2026",
      },
      {
        id: "COM-220",
        title: "Nicolas Ávila",
        detail: "8 vendas elegíveis · 2,5%",
        amount: "R$ 2.760,00",
        status: "Aprovada",
        tone: "success",
        due: "Outubro 2026",
      },
    ],
  },
  "controle-caixa": {
    title: "Controle de caixa",
    description:
      "Abertura, movimentos e fechamento demonstrativos por operador.",
    action: "Abrir caixa",
    filters: ["Todos", "Aberto", "Fechado", "Divergência"],
    rows: [
      {
        id: "CX-118",
        title: "PDV principal",
        detail: "Operador Nicolas · 18 movimentos",
        amount: "R$ 8.920,00",
        status: "Aberto",
        tone: "success",
        due: "Aberto às 08:04",
      },
      {
        id: "CX-117",
        title: "PDV fábrica",
        detail: "Operadora Mariana · 22 movimentos",
        amount: "R$ 12.480,00",
        status: "Fechado",
        tone: "neutral",
        due: "Ontem, 18:12",
      },
    ],
  },
  "faturamento-agrupado": {
    title: "Faturamento agrupado",
    description: "Agrupe cobranças elegíveis sem emitir títulos reais.",
    action: "Criar agrupamento",
    filters: ["Todos", "Elegível", "Preparado", "Concluído"],
    rows: [
      {
        id: "FAT-081",
        title: "Rede Academia Viva",
        detail: "6 pedidos · 3 unidades",
        amount: "R$ 48.720,00",
        status: "Elegível",
        tone: "warning",
        due: "Competência out/2026",
      },
      {
        id: "FAT-080",
        title: "Grupo Movimento",
        detail: "4 pedidos",
        amount: "R$ 31.440,00",
        status: "Concluído",
        tone: "success",
        due: "Competência set/2026",
      },
    ],
  },
  tributos: {
    title: "Tributos e guias",
    description:
      "Acompanhamento demonstrativo de DAS, GNRE e DARE-SP; nenhuma guia oficial é emitida.",
    action: "Nova consulta local",
    filters: ["Todos", "Pendente", "Disponível", "Pago"],
    rows: [
      {
        id: "GUIA-310",
        title: "GNRE · SP para MG",
        detail: "Documento fiscal 1042",
        amount: "R$ 482,10",
        status: "Pendente",
        tone: "warning",
        due: "28 out 2026",
      },
      {
        id: "GUIA-309",
        title: "DARE-SP",
        detail: "Competência setembro",
        amount: "R$ 1.840,32",
        status: "Pago",
        tone: "success",
        due: "20 out 2026",
      },
    ],
  },
  contador: {
    title: "Espaço meu contador",
    description:
      "Compartilhamento demonstrativo de documentos e relatórios com acesso controlado.",
    action: "Convidar contador",
    filters: ["Todos", "Compartilhado", "Pendente", "Expirado"],
    rows: [
      {
        id: "DOC-881",
        title: "Livro de entradas",
        detail: "Setembro 2026 · PDF",
        amount: "2,4 MB",
        status: "Compartilhado",
        tone: "success",
        due: "Enviado em 05 out",
      },
      {
        id: "DOC-879",
        title: "Relatório financeiro",
        detail: "Setembro 2026 · XLSX",
        amount: "840 KB",
        status: "Pendente",
        tone: "warning",
        due: "Aguardando revisão",
      },
    ],
  },
  "conta-digital": {
    title: "Conta digital",
    description:
      "Conceito de integração bancária desacoplada. Nenhuma conta é aberta ou movimentada.",
    action: "Conhecer integração",
    filters: ["Todos", "Disponível", "Em análise"],
    rows: [
      {
        id: "BANK-01",
        title: "Integração bancária",
        detail: "Provedor ainda não definido",
        amount: "Sem saldo",
        status: "Em análise",
        tone: "warning",
        due: "Depende de API e autorização",
      },
    ],
  },
};

const financeWorkflows: Record<string, { primary: string; secondary: string; fields: [string, string, string] }> = {
  "caixas-bancos": { primary: "Registrar movimentação", secondary: "Conciliar saldo", fields: ["Instituição", "Tipo da conta", "Saldo inicial"] },
  "contas-pagar": { primary: "Registrar baixa", secondary: "Estornar baixa", fields: ["Fornecedor", "Vencimento", "Categoria"] },
  "contas-receber": { primary: "Registrar recebimento", secondary: "Estornar recebimento", fields: ["Cliente", "Vencimento", "Forma de cobrança"] },
  "remessas-retornos": { primary: "Validar arquivo", secondary: "Processar retorno", fields: ["Banco", "Leiaute", "Arquivo"] },
  "ficha-financeira": { primary: "Abrir lançamento", secondary: "Exportar extrato", fields: ["Pessoa", "Período", "Tipo"] },
  comissoes: { primary: "Aprovar comissão", secondary: "Liquidar comissão", fields: ["Vendedor", "Período", "Percentual"] },
  "controle-caixa": { primary: "Registrar movimento", secondary: "Fechar caixa", fields: ["Operador", "Terminal", "Fundo inicial"] },
  "faturamento-agrupado": { primary: "Selecionar títulos", secondary: "Concluir agrupamento", fields: ["Cliente", "Competência", "Critério"] },
  tributos: { primary: "Consultar guia", secondary: "Marcar como paga", fields: ["Tributo", "Competência", "Documento fiscal"] },
  contador: { primary: "Compartilhar documento", secondary: "Revogar acesso", fields: ["Contador", "Documento", "Validade"] },
  "conta-digital": { primary: "Simular conexão", secondary: "Desconectar", fields: ["Provedor", "Conta", "Consentimento"] },
};

const shortcuts = [
  [
    "/financeiro/caixas-bancos",
    "Caixas e bancos",
    "Contas e movimentos",
    Landmark,
  ],
  [
    "/financeiro/contas-pagar",
    "Contas a pagar",
    "Obrigações e vencimentos",
    ReceiptText,
  ],
  [
    "/financeiro/contas-receber",
    "Contas a receber",
    "Recebíveis e baixas",
    WalletCards,
  ],
  [
    "/financeiro/remessas-retornos",
    "Remessas e retornos",
    "Arquivos bancários",
    Building2,
  ],
  [
    "/financeiro/ficha-financeira",
    "Ficha financeira",
    "Histórico por pessoa",
    Search,
  ],
  ["/financeiro/comissoes", "Comissões", "Cálculo e aprovação", Calculator],
  [
    "/financeiro/controle-caixa",
    "Controle de caixa",
    "Abertura e fechamento",
    WalletCards,
  ],
  [
    "/financeiro/faturamento-agrupado",
    "Faturamento agrupado",
    "Cobranças elegíveis",
    ReceiptText,
  ],
  ["/financeiro/tributos", "Tributos", "DAS, GNRE e DARE", ShieldCheck],
  [
    "/financeiro/contador",
    "Meu contador",
    "Documentos compartilhados",
    Building2,
  ],
  ["/financeiro/conta-digital", "Conta digital", "Integração futura", Landmark],
  ["/financeiro/relatorios", "Relatórios", "Fluxo, DRE e análises", BarChart3],
] as const;

export function FinanceOverview() {
  return (
    <Shell
      eyebrow="Gestão financeira"
      title="Financeiro"
      description="Visão demonstrativa de obrigações, recebíveis, caixa e análises da Ludus. Nenhum valor representa movimentação bancária real."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="A receber"
          value="R$ 184.720"
          detail="R$ 10.626 em atraso"
          tone="warning"
        />
        <Metric
          label="A pagar"
          value="R$ 72.840"
          detail="Próximos 30 dias"
          tone="neutral"
        />
        <Metric
          label="Disponível"
          value="R$ 132.270"
          detail="Saldos demonstrativos"
          tone="success"
        />
        <Metric
          label="Resultado mensal"
          value="R$ 48.190"
          detail="Prévia gerencial"
          tone="success"
        />
      </div>
      <section className="mt-7">
        <h2 className="text-lg font-semibold">Operação financeira</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map(([href, label, detail, Icon]) => (
            <Link
              className="rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30"
              href={href}
              key={href}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <strong className="mt-4 block">{label}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {detail}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export function FinanceList({ kind }: { kind: keyof typeof configs }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(config.filters[0]);
  const [state, setState] = useState<State>("ready");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const workflow = financeWorkflows[kind];
  const rows = useMemo(
    () =>
      config.rows.filter(
        (row) =>
          (!query ||
            `${row.id} ${row.title} ${row.detail}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.toLocaleLowerCase("pt-BR"))) &&
          (filter === config.filters[0] || row.status === filter),
      ),
    [config, filter, query],
  );
  return (
    <Shell
      eyebrow="Financeiro"
      title={config.title}
      description={config.description}
      back="/financeiro"
      actions={
        <>
          <select
            aria-label="Simular estado"
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            value={state}
            onChange={(event) => setState(event.target.value as State)}
          >
            <option value="ready">Conteúdo</option>
            <option value="loading">Carregamento</option>
            <option value="empty">Vazio</option>
            <option value="error">Erro</option>
            <option value="forbidden">Sem permissão</option>
          </select>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {config.action}
          </Button>
        </>
      }
    >
      {notice && (
        <p
          className="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar</span>
            <Input
              className="h-10 pl-9"
              placeholder="Pesquisar código ou descrição"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Filtrar por situação"
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {config.filters.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {state === "loading" && (
          <div className="space-y-3 p-5" aria-label="Carregando registros">
            {[1, 2, 3].map((item) => (
              <Skeleton className="h-20 w-full rounded-xl" key={item} />
            ))}
          </div>
        )}
        {state === "error" && (
          <Empty
            icon={RefreshCw}
            title="Não foi possível carregar"
            text="A demonstração ficou indisponível nesta tentativa."
          >
            <Button variant="outline" onClick={() => setState("ready")}>
              Tentar novamente
            </Button>
          </Empty>
        )}
        {state === "forbidden" && (
          <Empty
            icon={ShieldCheck}
            title="Acesso financeiro restrito"
            text="Solicite a permissão adequada ao administrador da empresa."
          />
        )}
        {(state === "empty" || (state === "ready" && !rows.length)) && (
          <Empty
            icon={Search}
            title="Nenhum registro encontrado"
            text="Ajuste a busca ou os filtros."
          />
        )}
        {state === "ready" &&
          rows.map((row) => <RowItem row={row} key={row.id} onOpen={() => setSelected(row)} />)}
      </section>
      {creating && <FinanceForm title={config.action} fields={workflow.fields} onCancel={() => setCreating(false)} onSave={() => { setCreating(false); setNotice(`${config.action} salvo localmente; nenhuma movimentação real ocorreu.`); }} />}
      {selected && <section className="mt-4 rounded-2xl border border-border bg-card p-5" aria-live="polite">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-primary">{selected.id}</p><h2 className="mt-1 text-xl font-semibold">{selected.title}</h2><p className="mt-2 text-sm text-muted-foreground">{selected.detail}</p></div><Button variant="ghost" onClick={() => setSelected(null)}>Fechar detalhe</Button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3"><FinanceDetail label="Valor" value={selected.amount} /><FinanceDetail label="Situação" value={selected.status} /><FinanceDetail label="Referência" value={selected.due} /></div>
        <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4"><strong className="text-sm">Histórico demonstrativo</strong><p className="mt-2 text-sm text-muted-foreground">Criado em 20 out 2026 · Conferido hoje. Baixa e estorno dependem de confirmação.</p></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{workflow.fields.map((label, index) => <FinanceDetail key={label} label={label} value={[selected.title, selected.due, selected.detail][index]} />)}</div>
        <div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => setNotice(`${selected.id}: ${workflow.primary.toLocaleLowerCase("pt-BR")} registrada somente nesta demonstração.`)}>{workflow.primary}</Button><Button variant="outline" onClick={() => { if (window.confirm(`${workflow.secondary} em ${selected.id}?`)) setNotice(`${selected.id}: ${workflow.secondary.toLocaleLowerCase("pt-BR")} registrada localmente; nenhuma movimentação real ocorreu.`); }}>{workflow.secondary}</Button></div>
      </section>}
    </Shell>
  );
}

export function FinanceReports() {
  const [notice, setNotice] = useState("");
  const [period, setPeriod] = useState("90");
  const [selectedReport, setSelectedReport] = useState("Fluxo de caixa projetado");
  return (
    <Shell
      eyebrow="Financeiro"
      title="Relatórios financeiros"
      description="Análises gerenciais simuladas, sem consolidação contábil ou bancária."
      back="/financeiro"
    >
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end"><label className="grid gap-1 text-xs text-muted-foreground">Período<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="30">30 dias</option><option value="90">90 dias</option><option value="365">12 meses</option></select></label><Button variant="outline" onClick={() => setNotice(`${selectedReport} exportado somente como demonstração.`)}>Exportar visão</Button></div>
      {notice && <p className="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-muted-foreground" role="status">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          "Fluxo de caixa projetado",
          "DRE gerencial",
          "Receitas e despesas",
          "Inadimplência por período",
        ].map((title) => (
          <section
            className="rounded-2xl border border-border bg-card p-6"
            key={title}
          >
            <BarChart3 className="size-5 text-primary" />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Prévia demonstrativa para validar filtros, agrupamentos e
              exportação futura.
            </p>
            <Button className="mt-5" variant={selectedReport === title ? "default" : "outline"} onClick={() => { setSelectedReport(title); setNotice(`${title}: prévia aberta localmente; nenhum dado foi consultado.`); }}>
              Abrir demonstração
            </Button>
          </section>
        ))}
      </div>
      <section className="mt-5 rounded-2xl border border-border bg-card p-5"><p className="text-sm font-medium text-primary">Detalhamento · {period === "365" ? "12 meses" : `${period} dias`}</p><h2 className="mt-1 text-xl font-semibold">{selectedReport}</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><FinanceDetail label="Entradas" value="R$ 184.720" /><FinanceDetail label="Saídas" value="R$ 136.530" /><FinanceDetail label="Resultado" value="R$ 48.190" /></div><p className="mt-4 text-sm text-muted-foreground">Valores demonstrativos para validação do fluxo; sem consolidação contábil ou bancária.</p></section>
    </Shell>
  );
}

function Shell({
  eyebrow,
  title,
  description,
  back,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  back?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      {back && (
        <Link
          className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          href={back}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Link>
      )}
      <header className="mb-7 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  const color = {
    success: "text-emerald-700 dark:text-emerald-400",
    warning: "text-amber-700 dark:text-amber-300",
    danger: "text-destructive",
    neutral: "text-primary",
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong className={`mt-2 block text-2xl ${color}`}>{value}</strong>
      <span className="mt-2 block text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}
function RowItem({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const tone = {
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "bg-destructive/10 text-destructive",
    neutral: "bg-muted text-muted-foreground",
  }[row.tone];
  return (
    <button type="button" onClick={onOpen} className="grid w-full gap-3 border-b border-border p-4 text-left transition last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[110px_minmax(0,1fr)_160px_160px] sm:items-center sm:p-5">
      <strong className="text-sm text-primary">{row.id}</strong>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{row.title}</h2>
        <p className="truncate text-sm text-muted-foreground">{row.detail}</p>
      </div>
      <div>
        <strong className="block text-sm">{row.amount}</strong>
        <span className="text-xs text-muted-foreground">{row.due}</span>
      </div>
      <span
        className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
      >
        {row.status}
      </span>
    </button>
  );
}
function FinanceDetail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted/40 p-3"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-1 block text-sm">{value}</strong></div>; }
function FinanceForm({ title, fields, onCancel, onSave }: { title: string; fields: [string, string, string]; onCancel: () => void; onSave: () => void }) { return <section className="mt-4 rounded-2xl border border-primary/30 bg-card p-5"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">Operação demonstrativa sem persistência ou integração bancária.</p><div className="mt-5 grid gap-4 sm:grid-cols-2">{fields.map((field) => <label className="grid gap-1.5 text-sm" key={field}>{field}<Input placeholder={`Informe ${field.toLocaleLowerCase("pt-BR")}`} /></label>)}<label className="grid gap-1.5 text-sm">Valor<Input inputMode="decimal" placeholder="R$ 0,00" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={onSave}>Salvar demonstração</Button></div></section>; }
function Empty({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: typeof Search;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-72 place-items-center p-6 text-center">
      <div>
        <Icon className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}
