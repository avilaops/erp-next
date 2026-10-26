"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BarChart3,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type ReportState = "ready" | "loading" | "empty" | "error" | "forbidden";

const reports = [
  {
    slug: "vendas",
    title: "Vendas",
    description: "Receita, pedidos, ticket médio e conversão.",
    icon: ShoppingCart,
    value: "R$ 184,6 mil",
    change: "+8,4%",
  },
  {
    slug: "estoque",
    title: "Estoque",
    description: "Giro, cobertura, rupturas e itens parados.",
    icon: Boxes,
    value: "1.248 itens",
    change: "23 alertas",
  },
  {
    slug: "financeiro",
    title: "Financeiro",
    description: "Fluxo de caixa, DRE e inadimplência.",
    icon: CircleDollarSign,
    value: "R$ 92,3 mil",
    change: "6,2% vencido",
  },
  {
    slug: "servicos",
    title: "Serviços",
    description: "Ordens, produtividade, custos e resultados.",
    icon: Wrench,
    value: "42 ordens",
    change: "91% no prazo",
  },
  {
    slug: "auditoria",
    title: "Auditoria",
    description: "Alterações, acessos e operações sensíveis.",
    icon: ShieldCheck,
    value: "386 eventos",
    change: "0 críticos",
  },
];

const rowsByReport: Record<string, string[][]> = {
  vendas: [
    ["Outubro/2026", "84 pedidos", "R$ 64.820,00", "Ticket R$ 771,67"],
    ["Setembro/2026", "76 pedidos", "R$ 58.410,00", "Ticket R$ 768,55"],
    ["Agosto/2026", "81 pedidos", "R$ 61.390,00", "Ticket R$ 757,90"],
  ],
  estoque: [
    ["Leg press 45°", "12 unidades", "Cobertura 28 dias", "Regular"],
    ["Banco regulável", "3 unidades", "Cobertura 6 dias", "Repor"],
    ["Crossover profissional", "0 unidades", "Sem cobertura", "Ruptura"],
  ],
  financeiro: [
    [
      "Outubro/2026",
      "Receitas R$ 92.300",
      "Despesas R$ 61.480",
      "Saldo R$ 30.820",
    ],
    [
      "Setembro/2026",
      "Receitas R$ 88.150",
      "Despesas R$ 59.920",
      "Saldo R$ 28.230",
    ],
    [
      "Agosto/2026",
      "Receitas R$ 79.840",
      "Despesas R$ 63.210",
      "Saldo R$ 16.630",
    ],
  ],
  servicos: [
    ["OS-2048", "Academia Horizonte", "Em execução", "Prazo hoje"],
    ["OS-2047", "Box Alpha", "Aguardando peça", "Prazo amanhã"],
    ["OS-2044", "Studio Fit Center", "Concluída", "Dentro do prazo"],
  ],
  auditoria: [
    ["24/10/2026 14:32", "Nicolas", "Alterou dados da empresa", "Sucesso"],
    [
      "24/10/2026 11:08",
      "Mariana",
      "Consultou relatório financeiro",
      "Sucesso",
    ],
    ["23/10/2026 18:41", "Sistema", "Tentativa de integração", "Revisar"],
  ],
};

const groupings: Record<string, string[]> = {
  vendas: ["Mês", "Canal", "Vendedor"],
  estoque: ["Produto", "Categoria", "Depósito"],
  financeiro: ["Mês", "Categoria", "Conta"],
  servicos: ["Ordem", "Técnico", "Situação"],
  auditoria: ["Data", "Usuário", "Ação"],
};

export function ReportsHub() {
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <Header
        title="Relatórios"
        description="Indicadores consolidados da empresa ativa. Todos os valores desta fase são demonstrativos."
      />
      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Link
              className="rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/40"
              href={`/relatorios/${report.slug}`}
              key={report.slug}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-5 text-lg font-semibold">{report.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.description}
              </p>
              <div className="mt-5 flex items-end justify-between gap-3">
                <strong className="text-xl">{report.value}</strong>
                <span className="text-xs text-muted-foreground">
                  {report.change}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

export function ReportDetail({ kind }: { kind: string }) {
  const report = reports.find((item) => item.slug === kind) ?? reports[0];
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("90");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<ReportState>("ready");
  const [compare, setCompare] = useState(false);
  const [grouping, setGrouping] = useState(groupings[report.slug][0]);
  const [selectedRow, setSelectedRow] = useState<string[] | null>(null);
  const rows = rowsByReport[report.slug] ?? rowsByReport.vendas;
  const visibleRows = rows.filter((row) =>
    row
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const Icon = report.icon;
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        href="/relatorios"
      >
        ← Todos os relatórios
      </Link>
      <div className="mt-5">
        <Header
          title={`Relatório de ${report.title.toLocaleLowerCase("pt-BR")}`}
          description={`${report.description} Prévia local sem consulta ao backend.`}
        />
      </div>
      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <Metric label="Indicador principal" value={report.value} icon={Icon} />
        <Metric
          label="Variação do período"
          value={report.change}
          icon={BarChart3}
        />
        <Metric
          label="Registros analisados"
          value="1.284"
          icon={ClipboardCheck}
        />
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="relative flex-1">
            <span className="sr-only">Buscar no relatório</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar no relatório"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Estado demonstrativo<select aria-label="Simular estado do relatório" className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={state} onChange={(event) => setState(event.target.value as ReportState)}><option value="ready">Conteúdo</option><option value="loading">Carregamento</option><option value="empty">Vazio</option><option value="error">Erro</option><option value="forbidden">Sem permissão</option></select></label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-input px-3 text-sm"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Comparar período</label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Período
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Últimos 12 meses</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Agrupar por<select aria-label="Agrupar relatório" className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={grouping} onChange={(event) => setGrouping(event.target.value)}>{groupings[report.slug].map((item) => <option key={item}>{item}</option>)}</select></label>
          <Button
            variant="outline"
            onClick={() =>
              setNotice(
                "Exportação preparada somente como demonstração; nenhum arquivo foi gerado.",
              )
            }
          >
            <Download />
            Exportar
          </Button>
        </div>
        {notice && (
          <p
            className="border-b border-border bg-primary/10 px-4 py-3 text-sm text-muted-foreground"
            role="status"
          >
            {notice}
          </p>
        )}
        {compare && state === "ready" && <p className="border-b border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Comparação ativa com o período imediatamente anterior · variação simulada de +8,4%.</p>}
        {state === "loading" && <div className="space-y-3 p-5" aria-label="Carregando relatório">{[1, 2, 3].map((item) => <Skeleton className="h-14 w-full rounded-xl" key={item} />)}</div>}
        {state === "error" && <ReportEmpty title="Não foi possível carregar o relatório" text="Tente novamente para restaurar os dados demonstrativos."><Button variant="outline" onClick={() => setState("ready")}><RefreshCw />Tentar novamente</Button></ReportEmpty>}
        {state === "forbidden" && <ReportEmpty title="Acesso ao relatório restrito" text="Solicite a permissão deste domínio ao administrador da empresa." />}
        {(state === "empty" || (state === "ready" && !visibleRows.length)) && <ReportEmpty title="Nenhum resultado encontrado" text="Altere o período ou o termo pesquisado." />}
        {state === "ready" && visibleRows.length ? (
          <div className="divide-y divide-border">
            {visibleRows.map((row) => (
              <button type="button" onClick={() => setSelectedRow(row)}
                className="grid w-full gap-2 p-4 text-left text-sm transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-4"
                key={row[0]}
              >
                {row.map((cell, index) => (
                  <span
                    className={
                      index === 0 ? "font-medium" : "text-muted-foreground"
                    }
                    key={`${row[0]}-${index}`}
                  >
                    {cell}
                  </span>
                ))}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {selectedRow && <section className="mt-5 rounded-2xl border border-border bg-card p-5" aria-live="polite"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-primary">Detalhamento por {grouping.toLocaleLowerCase("pt-BR")}</p><h2 className="mt-1 text-xl font-semibold">{selectedRow[0]}</h2></div><Button variant="ghost" onClick={() => setSelectedRow(null)}>Fechar detalhe</Button></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{selectedRow.slice(1).map((value, index) => <div className="rounded-xl bg-muted/40 p-3" key={value}><span className="text-xs text-muted-foreground">Indicador {index + 1}</span><strong className="mt-1 block text-sm">{value}</strong></div>)}</div><p className="mt-4 text-sm text-muted-foreground">Detalhamento demonstrativo do período selecionado, sem consulta ao backend.</p></section>}
    </div>
  );
}
function ReportEmpty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) { return <div className="grid min-h-48 place-items-center p-6 text-center"><div><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p>{children && <div className="mt-4">{children}</div>}</div></div>; }

function Header({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="border-b border-border pb-7">
      <p className="text-sm font-medium text-primary">
        Ludus Equipamentos / Relatórios
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">{description}</p>
    </header>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof BarChart3;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <strong className="block text-lg">{value}</strong>
      </div>
    </div>
  );
}
