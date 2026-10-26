"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Factory,
  PackageCheck,
  Plus,
  Search,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type State = "ready" | "loading" | "error" | "forbidden";
type Item = {
  title: string;
  code: string;
  detail: string;
  status: string;
  value: string;
};
type Config = {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  metrics: [string, string][];
  items: Item[];
};

const configs: Record<string, Config> = {
  overview: {
    eyebrow: "Estoque",
    title: "Visão geral do estoque",
    description:
      "Disponibilidade, movimentações e alertas operacionais da empresa ativa.",
    action: "Novo lançamento",
    metrics: [
      ["Itens disponíveis", "1.284"],
      ["Baixo estoque", "18"],
      ["Depósitos", "3"],
      ["Valor estimado", "R$ 842 mil"],
    ],
    items: [
      {
        title: "Saldos e disponibilidade",
        code: "Atualizado agora",
        detail: "Consulte quantidades físicas, reservadas e disponíveis.",
        status: "Saudável",
        value: "1.284 itens",
      },
      {
        title: "Inventários",
        code: "INV-2026-004",
        detail: "Conferência do depósito principal.",
        status: "Em andamento",
        value: "68%",
      },
      {
        title: "Ordens de produção",
        code: "OP-00981",
        detail: "Equipamentos em fabricação.",
        status: "Atenção",
        value: "7 abertas",
      },
    ],
  },
  balances: {
    eyebrow: "Estoque / Saldos",
    title: "Saldos e disponibilidade",
    description:
      "Posição demonstrativa por produto e depósito, sem movimentação real.",
    action: "Exportar consulta",
    metrics: [
      ["SKUs", "1.284"],
      ["Disponível", "8.492 un."],
      ["Reservado", "614 un."],
      ["Abaixo do mínimo", "18"],
    ],
    items: [
      {
        title: "Leg Press 45°",
        code: "LUD-LP45",
        detail: "Depósito principal · 12 físicas · 3 reservadas",
        status: "Disponível",
        value: "9 un.",
      },
      {
        title: "Banco regulável",
        code: "LUD-BR01",
        detail: "Depósito principal · 4 físicas · 4 reservadas",
        status: "Sem disponibilidade",
        value: "0 un.",
      },
      {
        title: "Crossover angular",
        code: "LUD-CR02",
        detail: "Expedição · 2 físicas · 0 reservadas",
        status: "Baixo estoque",
        value: "2 un.",
      },
    ],
  },
  movements: {
    eyebrow: "Estoque / Movimentações",
    title: "Lançamentos de estoque",
    description:
      "Livro local de entradas, saídas, transferências e ajustes simulados.",
    action: "Novo lançamento",
    metrics: [
      ["Hoje", "24"],
      ["Entradas", "11"],
      ["Saídas", "9"],
      ["Transferências", "4"],
    ],
    items: [
      {
        title: "Entrada de recebimento",
        code: "MOV-01842",
        detail: "Pedido PC-00482 · Depósito principal",
        status: "Entrada",
        value: "+24 un.",
      },
      {
        title: "Reserva de venda",
        code: "MOV-01841",
        detail: "Pedido PV-10438 · Expedição",
        status: "Saída",
        value: "-2 un.",
      },
      {
        title: "Transferência interna",
        code: "MOV-01840",
        detail: "Principal → Expedição",
        status: "Transferência",
        value: "8 un.",
      },
    ],
  },
  inventories: {
    eyebrow: "Estoque / Inventários",
    title: "Conferência de estoque",
    description:
      "Inventários, contagens e divergências registradas apenas nesta demonstração.",
    action: "Iniciar inventário",
    metrics: [
      ["Em andamento", "1"],
      ["Planejados", "2"],
      ["Divergências", "7"],
      ["Acurácia", "98,7%"],
    ],
    items: [
      {
        title: "Inventário mensal — Principal",
        code: "INV-2026-004",
        detail: "214 de 315 SKUs conferidos",
        status: "Em andamento",
        value: "68%",
      },
      {
        title: "Inventário — Expedição",
        code: "INV-2026-003",
        detail: "Concluído por Mariana Costa",
        status: "Concluído",
        value: "99,2%",
      },
      {
        title: "Contagem rotativa — Peças",
        code: "INV-2026-005",
        detail: "Programado para 28/10/2026",
        status: "Planejado",
        value: "48 SKUs",
      },
    ],
  },
  warehouses: {
    eyebrow: "Estoque / Depósitos",
    title: "Depósitos e localizações",
    description: "Armazéns, setores e capacidade operacional da empresa ativa.",
    action: "Novo depósito",
    metrics: [
      ["Depósitos", "3"],
      ["Localizações", "42"],
      ["Ocupação", "73%"],
      ["Bloqueadas", "2"],
    ],
    items: [
      {
        title: "Depósito principal",
        code: "DEP-01",
        detail: "Votuporanga · 28 localizações",
        status: "Ativo",
        value: "76% ocupado",
      },
      {
        title: "Expedição",
        code: "DEP-02",
        detail: "Votuporanga · 8 localizações",
        status: "Ativo",
        value: "64% ocupado",
      },
      {
        title: "Quarentena",
        code: "DEP-03",
        detail: "Itens em inspeção · 6 localizações",
        status: "Restrito",
        value: "12 itens",
      },
    ],
  },
  production: {
    eyebrow: "Estoque / Produção",
    title: "Ordens de produção",
    description:
      "Insumos, etapas, consumo previsto e produtos acabados simulados.",
    action: "Nova ordem",
    metrics: [
      ["Em produção", "7"],
      ["Atrasadas", "2"],
      ["Concluídas no mês", "31"],
      ["Eficiência", "91%"],
    ],
    items: [
      {
        title: "Leg Press 45° — 4 unidades",
        code: "OP-00981",
        detail: "Montagem · conclusão prevista 28/10",
        status: "Em produção",
        value: "72%",
      },
      {
        title: "Crossover angular — 2 unidades",
        code: "OP-00980",
        detail: "Pintura · aguardando inspeção",
        status: "Atenção",
        value: "54%",
      },
      {
        title: "Banco regulável — 10 unidades",
        code: "OP-00979",
        detail: "Embalagem final",
        status: "Em produção",
        value: "92%",
      },
    ],
  },
};

export function InventoryScreen({ kind }: { kind: keyof typeof configs }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>("ready");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(
    () =>
      config.items.filter((item) =>
        `${item.title} ${item.code} ${item.detail} ${item.status}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
    [config.items, query],
  );
  const createHref =
    kind === "overview" || kind === "movements"
      ? "/estoque/lancamentos/novo"
      : kind === "inventories"
        ? "/estoque/inventarios/novo"
        : kind === "warehouses"
          ? "/estoque/depositos/novo"
          : kind === "production"
            ? "/estoque/ordens-producao/novo"
            : undefined;
  const detailBase =
    kind === "movements"
      ? "/estoque/lancamentos"
      : kind === "inventories"
        ? "/estoque/inventarios"
        : kind === "warehouses"
          ? "/estoque/depositos"
          : kind === "production"
            ? "/estoque/ordens-producao"
            : undefined;
  return (
    <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
      <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{config.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {config.title}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {config.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="grid text-xs text-muted-foreground">
            Simular estado
            <select
              className="mt-1 h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={state}
              onChange={(event) => setState(event.target.value as State)}
            >
              <option value="ready">Conteúdo</option>
              <option value="loading">Carregamento</option>
              <option value="error">Erro</option>
              <option value="forbidden">Sem permissão</option>
            </select>
          </label>
          {createHref ? (
            <Link
              className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href={createHref}
            >
              <Plus className="size-4" />
              {config.action}
            </Link>
          ) : (
            <Button
              className="mt-5"
              onClick={() =>
                setNotice(
                  "Consulta preparada apenas na interface; nenhum arquivo foi gerado.",
                )
              }
            >
              <Plus />
              {config.action}
            </Button>
          )}
        </div>
      </header>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados simulados. Nenhum saldo, reserva, custo ou movimento foi
        persistido.
      </div>
      {notice && (
        <p
          className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
      <section
        className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicadores"
      >
        {config.metrics.map(([label, value], index) => (
          <div
            className="rounded-2xl border border-border bg-card p-4"
            key={label}
          >
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              {index === 0 ? (
                <Boxes className="size-4" />
              ) : index === 1 ? (
                <AlertTriangle className="size-4" />
              ) : index === 2 ? (
                <Warehouse className="size-4" />
              ) : (
                <Factory className="size-4" />
              )}
            </span>
            <strong className="mt-4 block text-2xl">{value}</strong>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        ))}
      </section>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Registros recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length} resultado(s)
            </p>
          </div>
          <label className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar</span>
            <Input
              className="h-10 pl-9"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por código, nome ou estado"
            />
          </label>
        </div>
        {state === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Carregando registros">
            {[1, 2, 3].map((item) => (
              <Skeleton className="h-20 w-full" key={item} />
            ))}
          </div>
        ) : state === "error" ? (
          <div className="grid min-h-64 place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-7 text-destructive" />
              <h2 className="mt-3 font-semibold">
                Não foi possível carregar os registros
              </h2>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => setState("ready")}
              >
                Tentar novamente
              </Button>
            </div>
          </div>
        ) : state === "forbidden" ? (
          <div className="grid min-h-64 place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">Acesso ao estoque restrito</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Solicite a permissão adequada ao administrador da empresa.
              </p>
            </div>
          </div>
        ) : filtered.length ? (
          <div className="divide-y divide-border">
            {filtered.map((item) => (
              <article
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_140px_120px] sm:items-center"
                key={item.code}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="size-4 shrink-0 text-primary" />
                    <h3 className="truncate font-medium">
                      {detailBase ? (
                        <Link
                          className="hover:text-primary hover:underline"
                          href={`${detailBase}/${item.code}`}
                        >
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.code} · {item.detail}
                  </p>
                </div>
                <span className="w-fit rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
                  {item.status}
                </span>
                <strong className="text-sm sm:text-right">{item.value}</strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-56 place-items-center p-6 text-center">
            <div>
              <Search className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">Nenhum registro encontrado</h2>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => setQuery("")}
              >
                Limpar busca
              </Button>
            </div>
          </div>
        )}
      </section>
      {kind === "overview" && (
        <nav
          className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Atalhos de estoque"
        >
          {[
            ["Saldos", "/estoque/saldos"],
            ["Movimentações", "/estoque/lancamentos"],
            ["Inventários", "/estoque/inventarios"],
            ["Depósitos", "/estoque/depositos"],
            ["Produção", "/estoque/ordens-producao"],
            ["Compras", "/compras"],
          ].map(([label, href]) => (
            <Link
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4 text-sm font-medium hover:bg-muted"
              href={href}
              key={href}
            >
              {label}
              <ArrowRightLeft className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
