"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardCheck,
  FileInput,
  Lightbulb,
  Plus,
  Search,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Item = {
  title: string;
  code: string;
  detail: string;
  status: string;
  value: string;
};
const screens: Record<
  string,
  {
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    metrics: [string, string][];
    items: Item[];
  }
> = {
  overview: {
    eyebrow: "Compras",
    title: "Central de compras",
    description:
      "Pedidos, recebimentos e reposição em uma visão demonstrativa.",
    action: "Novo pedido",
    metrics: [
      ["Pedidos abertos", "12"],
      ["Aguardando aprovação", "3"],
      ["Recebimentos hoje", "4"],
      ["Sugestões", "18"],
    ],
    items: [
      {
        title: "Pedido de compra",
        code: "PC-00482",
        detail: "Aço Rio Preto · entrega em 28/10",
        status: "Aprovado",
        value: "R$ 48.320",
      },
      {
        title: "Recebimento",
        code: "REC-00214",
        detail: "Componentes Atlas · docas 02",
        status: "Em conferência",
        value: "36 volumes",
      },
      {
        title: "Sugestão de reposição",
        code: "SUG-00118",
        detail: "18 itens abaixo do estoque mínimo",
        status: "Revisar",
        value: "R$ 21.840",
      },
    ],
  },
  orders: {
    eyebrow: "Compras / Pedidos",
    title: "Pedidos de compra",
    description:
      "Solicitações, aprovações e entregas previstas, sem emissão real.",
    action: "Novo pedido",
    metrics: [
      ["Em aberto", "12"],
      ["Para aprovar", "3"],
      ["Atrasados", "2"],
      ["No mês", "R$ 286 mil"],
    ],
    items: [
      {
        title: "Aço carbono e chapas",
        code: "PC-00482",
        detail: "Aço Rio Preto · 28/10/2026",
        status: "Aprovado",
        value: "R$ 48.320",
      },
      {
        title: "Estofados e espumas",
        code: "PC-00481",
        detail: "Espumas Paulista · 30/10/2026",
        status: "Em aprovação",
        value: "R$ 17.890",
      },
      {
        title: "Rolamentos industriais",
        code: "PC-00479",
        detail: "Componentes Atlas · vencido em 23/10",
        status: "Atrasado",
        value: "R$ 8.450",
      },
    ],
  },
  invoices: {
    eyebrow: "Compras / Documentos",
    title: "Notas fiscais de entrada",
    description:
      "Importação e validação local de XML, sem transmitir ou escriturar documentos.",
    action: "Selecionar XML",
    metrics: [
      ["Recebidas hoje", "6"],
      ["Validadas", "5"],
      ["Com divergência", "1"],
      ["Aguardando vínculo", "2"],
    ],
    items: [
      {
        title: "NF-e 000.184.322",
        code: "352610…8421",
        detail: "Aço Rio Preto · PC-00482",
        status: "Validada",
        value: "R$ 48.320",
      },
      {
        title: "NF-e 000.009.871",
        code: "352610…9184",
        detail: "Componentes Atlas · quantidade divergente",
        status: "Divergência",
        value: "R$ 8.450",
      },
      {
        title: "NF-e 000.112.504",
        code: "352610…5012",
        detail: "Tintas Industrial · sem pedido vinculado",
        status: "Revisar",
        value: "R$ 6.280",
      },
    ],
  },
  suggestions: {
    eyebrow: "Compras / Reposição",
    title: "Sugestões de compras",
    description:
      "Necessidades calculadas localmente a partir de mínimos e demanda simulada.",
    action: "Gerar pedido",
    metrics: [
      ["Itens sugeridos", "18"],
      ["Críticos", "5"],
      ["Fornecedores", "7"],
      ["Estimativa", "R$ 63 mil"],
    ],
    items: [
      {
        title: "Tubo aço 50 × 50 mm",
        code: "INS-0018",
        detail: "Disponível 8 · mínimo 40 · demanda 22",
        status: "Crítico",
        value: "Sugerido 54",
      },
      {
        title: "Rolamento 6204",
        code: "INS-0042",
        detail: "Disponível 12 · mínimo 25 · demanda 8",
        status: "Repor",
        value: "Sugerido 21",
      },
      {
        title: "Espuma D45",
        code: "INS-0081",
        detail: "Disponível 16 · mínimo 20 · demanda 4",
        status: "Repor",
        value: "Sugerido 8",
      },
    ],
  },
  receiving: {
    eyebrow: "Compras / Recebimento",
    title: "Check-in de recebimentos",
    description:
      "Conferência física, divergências e entrada simulada no estoque.",
    action: "Iniciar check-in",
    metrics: [
      ["Agendados hoje", "4"],
      ["Em conferência", "1"],
      ["Com divergência", "1"],
      ["Finalizados", "7"],
    ],
    items: [
      {
        title: "Aço Rio Preto",
        code: "REC-00215",
        detail: "PC-00482 · doca 01 · 42 volumes",
        status: "Agendado",
        value: "14:30",
      },
      {
        title: "Componentes Atlas",
        code: "REC-00214",
        detail: "PC-00479 · doca 02 · 36 volumes",
        status: "Em conferência",
        value: "72%",
      },
      {
        title: "Tintas Industrial",
        code: "REC-00213",
        detail: "2 volumes avariados registrados",
        status: "Divergência",
        value: "Revisar",
      },
    ],
  },
};

export function PurchasingScreen({ kind }: { kind: keyof typeof screens }) {
  const config = screens[kind];
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    "ready" | "loading" | "error" | "forbidden"
  >("ready");
  const [message, setMessage] = useState("");
  const filtered = useMemo(
    () =>
      config.items.filter((item) =>
        `${item.title} ${item.code} ${item.detail} ${item.status}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
    [config.items, query],
  );
  const icon =
    kind === "invoices"
      ? FileInput
      : kind === "suggestions"
        ? Lightbulb
        : kind === "receiving"
          ? ClipboardCheck
          : ShoppingCart;
  const Icon = icon;
  const detailBase =
    kind === "orders"
      ? "/compras/pedidos"
      : kind === "invoices"
        ? "/compras/notas-entrada"
        : kind === "suggestions"
          ? "/compras/sugestoes"
          : kind === "receiving"
            ? "/compras/recebimentos"
            : undefined;
  function action() {
    if (kind === "orders" || kind === "overview") return;
    setMessage(`${config.action} iniciado apenas nesta demonstração.`);
  }
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
              className="mt-1 h-9 rounded-lg border border-input bg-background px-3 text-sm"
              value={state}
              onChange={(e) => setState(e.target.value as typeof state)}
            >
              <option value="ready">Conteúdo</option>
              <option value="loading">Carregamento</option>
              <option value="error">Erro</option>
              <option value="forbidden">Sem permissão</option>
            </select>
          </label>
          {kind === "orders" || kind === "overview" ? (
            <Link
              className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href="/compras/pedidos/novo"
            >
              <Plus className="size-4" />
              {config.action}
            </Link>
          ) : (
            <Button className="mt-5" onClick={action}>
              <Plus />
              {config.action}
            </Button>
          )}
        </div>
      </header>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados simulados. Nenhum pedido, documento fiscal, recebimento ou
        movimento foi persistido.
      </div>
      {message && (
        <p
          className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm"
          role="status"
        >
          {message}
        </p>
      )}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {config.metrics.map(([label, value]) => (
          <div
            className="rounded-2xl border border-border bg-card p-4"
            key={label}
          >
            <Icon className="size-5 text-primary" />
            <strong className="mt-4 block text-2xl">{value}</strong>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        ))}
      </section>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Registros operacionais</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length} resultado(s)
            </p>
          </div>
          <label className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar</span>
            <Input
              className="h-10 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar registros"
            />
          </label>
        </div>
        {state === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Carregando compras">
            {[1, 2, 3].map((i) => (
              <Skeleton className="h-20" key={i} />
            ))}
          </div>
        ) : state === "error" ? (
          <div className="grid min-h-56 place-items-center text-center">
            <div>
              <AlertTriangle className="mx-auto size-7 text-destructive" />
              <h2 className="mt-3 font-semibold">Falha ao carregar</h2>
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
          <div className="grid min-h-56 place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">Acesso a compras restrito</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Solicite a permissão adequada ao administrador da empresa.
              </p>
            </div>
          </div>
        ) : filtered.length ? (
          <div className="divide-y divide-border">
            {filtered.map((item, index) => {
              const detailId =
                kind === "invoices"
                  ? item.title.replace(/\D/g, "")
                  : kind === "suggestions"
                    ? ["sug-00118", "sug-00117", "sug-00116"][index]
                    : item.code.toLocaleLowerCase("pt-BR");
              return (
                <article
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_140px_130px] sm:items-center"
                  key={item.code}
                >
                  <div>
                    <h3 className="font-medium">
                      {detailBase ? (
                        <Link
                          className="hover:text-primary hover:underline"
                          href={`${detailBase}/${detailId}`}
                        >
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.code} · {item.detail}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
                    {item.status}
                  </span>
                  <strong className="text-sm sm:text-right">
                    {item.value}
                  </strong>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-56 place-items-center text-center">
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
        <nav className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Pedidos", "/compras/pedidos"],
            ["Notas de entrada", "/compras/notas-entrada"],
            ["Sugestões", "/compras/sugestoes"],
            ["Recebimentos", "/compras/recebimentos"],
          ].map(([label, href]) => (
            <Link
              className="rounded-xl border border-border bg-card p-4 text-sm font-medium hover:bg-muted"
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
