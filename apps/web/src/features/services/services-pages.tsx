"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FileCheck2,
  FileText,
  HandCoins,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type State = "ready" | "loading" | "empty" | "error" | "forbidden";
type Tone = "success" | "warning" | "neutral" | "danger";
type Row = {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  status: string;
  tone: Tone;
  date: string;
};
type Kind = "contracts" | "orders" | "cte" | "invoices" | "charges";

const configs: Record<
  Kind,
  {
    title: string;
    description: string;
    action: string;
    rows: Row[];
    filters: string[];
  }
> = {
  contracts: {
    title: "Contratos",
    description:
      "Vigência, renovação e situação comercial dos contratos de serviço.",
    action: "Novo contrato",
    filters: ["Todos", "Ativo", "Renovação próxima", "Encerrado"],
    rows: [
      {
        id: "CTR-128",
        title: "Academia Horizonte",
        subtitle: "Manutenção preventiva mensal",
        value: "R$ 2.480/mês",
        status: "Ativo",
        tone: "success",
        date: "Renova em 32 dias",
      },
      {
        id: "CTR-125",
        title: "Studio Força Total",
        subtitle: "Assistência técnica trimestral",
        value: "R$ 1.290/mês",
        status: "Renovação próxima",
        tone: "warning",
        date: "Renova em 8 dias",
      },
      {
        id: "CTR-119",
        title: "Centro Atlas",
        subtitle: "Instalação e acompanhamento",
        value: "R$ 8.700",
        status: "Encerrado",
        tone: "neutral",
        date: "18 out",
      },
    ],
  },
  orders: {
    title: "Ordens de serviço",
    description: "Abertura, execução, materiais utilizados e conclusão.",
    action: "Nova ordem",
    filters: ["Todas", "Aberta", "Em execução", "Aguardando peça", "Concluída"],
    rows: [
      {
        id: "OS-2048",
        title: "Academia Horizonte",
        subtitle: "Revisão de cabos · Técnico: Marcos",
        value: "2 equipamentos",
        status: "Em execução",
        tone: "warning",
        date: "Hoje, 10:30",
      },
      {
        id: "OS-2047",
        title: "Box Alpha",
        subtitle: "Troca de estofado · Técnico: Júlia",
        value: "1 equipamento",
        status: "Aguardando peça",
        tone: "danger",
        date: "Hoje, 08:10",
      },
      {
        id: "OS-2044",
        title: "Studio Fit Center",
        subtitle: "Instalação de conjunto",
        value: "6 equipamentos",
        status: "Concluída",
        tone: "success",
        date: "Ontem, 16:45",
      },
    ],
  },
  cte: {
    title: "CT-e",
    description:
      "Documentos de transporte demonstrativos; nenhuma emissão oficial é executada.",
    action: "Preparar CT-e",
    filters: [
      "Todos",
      "Rascunho",
      "Aguardando autorização",
      "Autorizado",
      "Rejeitado",
    ],
    rows: [
      {
        id: "CTE-0841",
        title: "Ludus → Academia Horizonte",
        subtitle: "São José do Rio Preto → Votuporanga",
        value: "R$ 780,00",
        status: "Rascunho",
        tone: "neutral",
        date: "Hoje, 11:20",
      },
      {
        id: "CTE-0840",
        title: "Ludus → Studio Fit Center",
        subtitle: "Votuporanga → Araçatuba",
        value: "R$ 540,00",
        status: "Autorizado",
        tone: "success",
        date: "Ontem, 15:12",
      },
    ],
  },
  invoices: {
    title: "Notas de serviço",
    description:
      "Preparação e acompanhamento simulado de NFS-e, sem transmissão municipal ou nacional.",
    action: "Preparar nota",
    filters: ["Todas", "Rascunho", "Processando", "Autorizada", "Erro"],
    rows: [
      {
        id: "NFS-331",
        title: "Academia Horizonte",
        subtitle: "Manutenção preventiva · competência outubro",
        value: "R$ 2.480,00",
        status: "Rascunho",
        tone: "neutral",
        date: "Hoje",
      },
      {
        id: "NFS-329",
        title: "Studio Força Total",
        subtitle: "Assistência técnica",
        value: "R$ 1.290,00",
        status: "Autorizada",
        tone: "success",
        date: "21 out",
      },
      {
        id: "NFS-328",
        title: "Centro Atlas",
        subtitle: "Instalação",
        value: "R$ 8.700,00",
        status: "Erro",
        tone: "danger",
        date: "Falha segura: cadastro incompleto",
      },
    ],
  },
  charges: {
    title: "Cobranças de serviços",
    description:
      "Consolide serviços elegíveis antes do faturamento financeiro.",
    action: "Nova cobrança",
    filters: ["Todas", "Pendente", "Pronta", "Faturada", "Vencida"],
    rows: [
      {
        id: "COB-771",
        title: "Academia Horizonte",
        subtitle: "Contrato CTR-128 · outubro",
        value: "R$ 2.480,00",
        status: "Pronta",
        tone: "success",
        date: "Vence em 12 dias",
      },
      {
        id: "COB-770",
        title: "Box Alpha",
        subtitle: "Ordem OS-2047",
        value: "R$ 690,00",
        status: "Pendente",
        tone: "warning",
        date: "Aguardando conclusão",
      },
      {
        id: "COB-764",
        title: "Studio Fit Center",
        subtitle: "Contrato CTR-121",
        value: "R$ 1.180,00",
        status: "Vencida",
        tone: "danger",
        date: "Venceu há 4 dias",
      },
    ],
  },
};

const serviceWorkflows: Record<Kind, { primary: string; secondary: string; fields: [string, string, string] }> = {
  contracts: { primary: "Renovar vigência", secondary: "Encerrar contrato", fields: ["Vigência", "Periodicidade", "Responsável"] },
  orders: { primary: "Iniciar execução", secondary: "Concluir ordem", fields: ["Técnico", "Materiais", "SLA"] },
  cte: { primary: "Validar documento", secondary: "Simular autorização", fields: ["Tomador", "Percurso", "Chave demonstrativa"] },
  invoices: { primary: "Validar nota", secondary: "Simular autorização", fields: ["Competência", "Código do serviço", "Município"] },
  charges: { primary: "Preparar cobrança", secondary: "Marcar faturada", fields: ["Competência", "Origem", "Vencimento"] },
};

const shortcuts = [
  {
    href: "/servicos/contratos",
    label: "Contratos",
    detail: "Vigência e renovação",
    icon: FileCheck2,
  },
  {
    href: "/servicos/ordens",
    label: "Ordens de serviço",
    detail: "Execução e materiais",
    icon: ClipboardList,
  },
  {
    href: "/servicos/cte",
    label: "CT-e",
    detail: "Transporte demonstrativo",
    icon: FileText,
  },
  {
    href: "/servicos/notas",
    label: "Notas de serviço",
    detail: "NFS-e demonstrativa",
    icon: FileText,
  },
  {
    href: "/servicos/cobrancas",
    label: "Cobranças",
    detail: "Serviços elegíveis",
    icon: HandCoins,
  },
  {
    href: "/servicos/relatorios",
    label: "Relatórios",
    detail: "Produtividade e custos",
    icon: BarChart3,
  },
];

export function ServicesOverview() {
  return (
    <Shell
      title="Serviços"
      eyebrow="Operação de serviços"
      description="Contratos, execução técnica, documentos e cobranças em uma visão única. Dados demonstrativos da Ludus."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Ordens abertas"
          value="12"
          detail="4 em execução"
          tone="warning"
        />
        <Metric
          label="Contratos ativos"
          value="28"
          detail="3 renovações próximas"
          tone="success"
        />
        <Metric
          label="Receita prevista"
          value="R$ 46.780"
          detail="Competência atual"
          tone="neutral"
        />
        <Metric
          label="SLA no prazo"
          value="94,2%"
          detail="Últimos 30 dias"
          tone="success"
        />
      </div>
      <section className="mt-7">
        <h2 className="text-lg font-semibold">Operação</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map(({ icon: Icon, ...item }) => (
            <Link
              className="rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30"
              href={item.href}
              key={item.href}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <strong className="mt-4 block">{item.label}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {item.detail}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <aside className="mt-7 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground">
        CT-e e NFS-e são somente protótipos de interface. Nenhum documento é
        assinado, transmitido ou consultado em ambiente oficial.
      </aside>
    </Shell>
  );
}

export function ServicesList({ kind }: { kind: Kind }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(config.filters[0]);
  const [state, setState] = useState<State>("ready");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const workflow = serviceWorkflows[kind];
  const filtered = useMemo(
    () =>
      config.rows.filter(
        (row) =>
          (!query ||
            `${row.id} ${row.title} ${row.subtitle}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.toLocaleLowerCase("pt-BR"))) &&
          (filter === config.filters[0] || row.status === filter),
      ),
    [config, filter, query],
  );
  return (
    <Shell
      title={config.title}
      eyebrow="Serviços"
      description={config.description}
      back="/servicos"
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
      {message && (
        <p
          className="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm"
          role="status"
        >
          {message}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar</span>
            <Input
              className="h-10 pl-9"
              placeholder="Pesquisar código, cliente ou descrição"
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
          <div className="space-y-3 p-5" aria-label="Carregando serviços">
            {[1, 2, 3].map((item) => (
              <Skeleton className="h-20 w-full rounded-xl" key={item} />
            ))}
          </div>
        )}
        {state === "error" && (
          <Empty
            icon={RefreshCw}
            title="Não foi possível carregar"
            description="Tente novamente para restaurar os dados demonstrativos."
          >
            <Button variant="outline" onClick={() => setState("ready")}>
              Tentar novamente
            </Button>
          </Empty>
        )}
        {state === "forbidden" && (
          <Empty icon={ShieldAlert} title="Acesso a serviços restrito" description="Solicite a permissão adequada ao administrador da empresa." />
        )}
        {(state === "empty" ||
          (state === "ready" && filtered.length === 0)) && (
          <Empty
            icon={Search}
            title="Nenhum registro encontrado"
            description="Altere a pesquisa ou os filtros selecionados."
          />
        )}
        {state === "ready" &&
          filtered.map((row) => <RowItem row={row} key={row.id} onOpen={() => setSelected(row)} />)}
      </section>
      {creating && <WorkflowForm title={config.action} fields={workflow.fields} onCancel={() => setCreating(false)} onSave={() => { setCreating(false); setMessage(`${config.action} salvo somente nesta demonstração.`); }} />}
      {selected && <section className="mt-4 rounded-2xl border border-border bg-card p-5" aria-live="polite">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-primary">{selected.id}</p><h2 className="mt-1 text-xl font-semibold">{selected.title}</h2><p className="mt-2 text-sm text-muted-foreground">{selected.subtitle}</p></div><Button variant="ghost" onClick={() => setSelected(null)}>Fechar detalhe</Button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3"><Detail label="Situação" value={selected.status} /><Detail label="Valor ou quantidade" value={selected.value} /><Detail label="Prazo" value={selected.date} /></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{workflow.fields.map((label, index) => <Detail key={label} label={label} value={[selected.date, selected.subtitle, "Mariana Costa"][index]} />)}</div>
        <div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => setMessage(`${selected.id}: ${workflow.primary.toLocaleLowerCase("pt-BR")} registrada localmente.`)}>{workflow.primary}</Button><Button variant="outline" onClick={() => { if (window.confirm(`${workflow.secondary} em ${selected.id}?`)) setMessage(`${selected.id}: ${workflow.secondary.toLocaleLowerCase("pt-BR")} registrada somente na demonstração.`); }}>{workflow.secondary}</Button></div>
      </section>}
    </Shell>
  );
}

export function ServiceReports() {
  const [period, setPeriod] = useState("30");
  const [selectedReport, setSelectedReport] = useState("Produtividade por técnico");
  const [notice, setNotice] = useState("");
  return (
    <Shell
      title="Relatórios de serviços"
      eyebrow="Serviços"
      description="Indicadores simulados de produtividade, custos e resultado."
      back="/servicos"
    >
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end"><label className="grid gap-1 text-xs text-muted-foreground">Período<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><Button variant="outline" onClick={() => setNotice(`${selectedReport} exportado apenas como demonstração para ${period} dias.`)}>Exportar visão</Button></div>
      {notice && <p className="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm" role="status">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          "Produtividade por técnico",
          "Ordens por situação",
          "Custo de materiais",
          "Receita por contrato",
          "SLA de atendimento",
          "Margem por serviço",
        ].map((title, index) => (
          <button type="button" onClick={() => setSelectedReport(title)}
            className={`rounded-2xl border bg-card p-6 text-left transition hover:border-primary/40 ${selectedReport === title ? "border-primary ring-1 ring-primary/20" : "border-border"}`}
            key={title}
          >
            <BarChart3 className="size-5 text-primary" />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <strong className="mt-3 block text-2xl">
              {
                [
                  "38 OS",
                  "12 abertas",
                  "R$ 8.420",
                  "R$ 46.780",
                  "94,2%",
                  "31,4%",
                ][index]
              }
            </strong>
            <p className="mt-2 text-sm text-muted-foreground">
              Consolidação local de demonstração, sem dados financeiros
              oficiais.
            </p>
          </button>
        ))}
      </div>
      <section className="mt-5 rounded-2xl border border-border bg-card p-5"><p className="text-sm font-medium text-primary">Detalhamento · {period} dias</p><h2 className="mt-1 text-xl font-semibold">{selectedReport}</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><Detail label="Atual" value="94,2%" /><Detail label="Período anterior" value="91,8%" /><Detail label="Variação" value="+2,4 p.p." /></div><p className="mt-4 text-sm text-muted-foreground">Comparação local demonstrativa. Selecione outro indicador para atualizar esta visão.</p></section>
    </Shell>
  );
}

function Shell({
  title,
  eyebrow,
  description,
  back,
  actions,
  children,
}: {
  title: string;
  eyebrow: string;
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
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
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
  const colors: Record<Tone, string> = {
    success: "text-emerald-700 dark:text-emerald-400",
    warning: "text-amber-700 dark:text-amber-300",
    neutral: "text-primary",
    danger: "text-destructive",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong className={`mt-2 block text-2xl ${colors[tone]}`}>{value}</strong>
      <span className="mt-2 block text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}
function RowItem({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const tones: Record<Tone, string> = {
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    neutral: "bg-muted text-muted-foreground",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <button type="button" onClick={onOpen} className="grid w-full gap-3 border-b border-border p-4 text-left transition last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[110px_minmax(0,1fr)_160px_180px] sm:items-center sm:p-5">
      <strong className="text-sm text-primary">{row.id}</strong>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium">{row.title}</h2>
        <p className="truncate text-sm text-muted-foreground">{row.subtitle}</p>
      </div>
      <div>
        <strong className="block text-sm">{row.value}</strong>
        <span className="text-xs text-muted-foreground">{row.date}</span>
      </div>
      <span
        className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${tones[row.tone]}`}
      >
        {row.status}
      </span>
    </button>
  );
}
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted/40 p-3"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-1 block text-sm">{value}</strong></div>; }
function WorkflowForm({ title, fields, onCancel, onSave }: { title: string; fields: [string, string, string]; onCancel: () => void; onSave: () => void }) { return <section className="mt-4 rounded-2xl border border-primary/30 bg-card p-5"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">Cadastro demonstrativo sem persistência.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Cliente<Input placeholder="Nome do cliente" /></label>{fields.map((field) => <label className="grid gap-1.5 text-sm" key={field}>{field}<Input placeholder={`Informe ${field.toLocaleLowerCase("pt-BR")}`} /></label>)}</div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={onSave}>Salvar demonstração</Button></div></section>; }
function Empty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Search;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-72 place-items-center p-6 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <h2 className="mt-4 font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}
