"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Kind =
  | "overview"
  | "postings"
  | "returns"
  | "checkout"
  | "labels"
  | "shipping";
type State = "ready" | "loading" | "empty" | "error" | "forbidden";
const configs = {
  postings: {
    title: "Objetos de postagem",
    action: "Nova postagem",
    rows: [
      [
        "OBJ-2481",
        "Academia Horizonte",
        "Etiqueta simulada · aguardando coleta",
        "Preparado",
      ],
      ["OBJ-2480", "Studio Força Total", "Rastreio BR123•••890", "Em trânsito"],
      [
        "OBJ-2479",
        "Centro Esportivo Atlas",
        "Entrega demonstrativa concluída",
        "Entregue",
      ],
    ],
  },
  returns: {
    title: "Logística reversa",
    action: "Nova autorização",
    rows: [
      [
        "REV-091",
        "Box Alpha",
        "Cabo de crossover · garantia GAR-087",
        "Autorizada",
      ],
      [
        "REV-090",
        "Academia Vital",
        "Estofado de banco regulável",
        "Em trânsito",
      ],
      ["REV-088", "Studio Arena", "Peça recebida para análise", "Recebida"],
    ],
  },
  checkout: {
    title: "Checkout de pedidos",
    action: "Iniciar conferência",
    rows: [
      [
        "PV-1048",
        "Academia Horizonte",
        "8 itens · 6 conferidos",
        "Em conferência",
      ],
      ["PV-1047", "Studio Força Total", "3 itens conferidos", "Pronto"],
      [
        "PV-1046",
        "Centro Esportivo Atlas",
        "12 itens · separação pendente",
        "Aguardando",
      ],
    ],
  },
  labels: {
    title: "Impressão de etiquetas",
    action: "Adicionar à fila",
    rows: [
      [
        "FILA-331",
        "Etiqueta de transporte",
        "Impressora Expedição 01",
        "Na fila",
      ],
      [
        "FILA-330",
        "Volumes PV-1047",
        "3 etiquetas demonstrativas",
        "Concluída",
      ],
      [
        "FILA-329",
        "Etiqueta reversa REV-091",
        "Impressora indisponível",
        "Atenção",
      ],
    ],
  },
  shipping: {
    title: "Ávila Envios",
    action: "Simular cotação",
    rows: [
      [
        "COT-1842",
        "Votuporanga → Belo Horizonte",
        "Transportadora A · 3 dias",
        "R$ 284,90",
      ],
      [
        "COT-1841",
        "Votuporanga → Campinas",
        "Transportadora B · 1 dia",
        "R$ 148,20",
      ],
      [
        "COT-1840",
        "Votuporanga → Curitiba",
        "Transportadora C · 4 dias",
        "R$ 319,50",
      ],
    ],
  },
} as const;

const shortcuts = [
  ["Postagens", "/logistica/postagens", PackageCheck],
  ["Logística reversa", "/logistica/reversa", RotateCcw],
  ["Checkout", "/logistica/checkout", CheckCircle2],
  ["Etiquetas", "/logistica/etiquetas", Printer],
  ["Ávila Envios", "/logistica/envios", Truck],
] as const;

const createRoutes = {
  postings: "/logistica/postagens/novo",
  returns: "/logistica/reversa/nova",
  checkout: "/logistica/checkout/PV-1048",
  labels: "/logistica/etiquetas/nova",
  shipping: "/logistica/envios/nova",
} as const;

const detailRoutes = {
  postings: "/logistica/postagens",
  returns: "/logistica/reversa",
  checkout: "/logistica/checkout",
  labels: "/logistica/etiquetas",
  shipping: "/logistica/envios",
} as const;

export function LogisticsScreen({ kind }: { kind: Kind }) {
  if (kind === "overview") return <Overview />;
  return <LogisticsList kind={kind} />;
}

function LogisticsList({ kind }: { kind: Exclude<Kind, "overview"> }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>("ready");
  const rows = useMemo(
    () =>
      config.rows.filter((row) =>
        row
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
    [config.rows, query],
  );
  return (
    <Shell
      title={config.title}
      description="Operação logística demonstrativa. Nenhuma etiqueta, postagem, cotação ou contratação será transmitida."
      back
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
          <Button render={<Link href={createRoutes[kind]} />}>
            <Plus />
            {config.action}
          </Button>
        </>
      }
    >
      <DemoNotice />
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <label className="relative block max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar logística</span>
            <Input
              className="pl-9"
              placeholder="Buscar código, cliente ou situação"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {state === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Carregando logística">
            {[1, 2, 3].map((id) => (
              <Skeleton className="h-20" key={id} />
            ))}
          </div>
        ) : state === "error" ? (
          <Panel
            title="Não foi possível carregar"
            action={() => setState("ready")}
          />
        ) : state === "forbidden" ? (
          <Panel title="Acesso à logística restrito" action={() => setState("ready")} />
        ) : state === "empty" || !rows.length ? (
          <Panel
            title="Nenhum registro encontrado"
            action={() => {
              setQuery("");
              setState("ready");
            }}
          />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <article
                className="grid gap-3 p-4 sm:grid-cols-[120px_minmax(0,1fr)_170px] sm:items-center"
                key={row[0]}
              >
                <Link
                  className="text-sm font-semibold text-primary hover:underline"
                  href={`${detailRoutes[kind]}/${row[0]}`}
                >
                  {row[0]}
                </Link>
                <div>
                  <h2 className="text-sm font-medium">{row[1]}</h2>
                  <p className="text-sm text-muted-foreground">{row[2]}</p>
                </div>
                <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">
                  {row[3]}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function Overview() {
  return (
    <Shell
      title="Logística"
      description="Expedição, conferência, etiquetas, rastreamento e devoluções da empresa ativa."
    >
      <DemoNotice />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["A expedir", "12"],
          ["Em trânsito", "18"],
          ["Atenções", "3"],
          ["Entregues hoje", "7"],
        ].map(([label, value]) => (
          <div
            className="rounded-2xl border border-border bg-card p-5"
            key={label}
          >
            <Box className="size-5 text-primary" />
            <strong className="mt-4 block text-2xl">{value}</strong>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      <nav className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map(([label, href, Icon]) => (
          <Link
            className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-muted/30"
            href={href}
            key={href}
          >
            <Icon className="size-5 text-primary" />
            <strong className="mt-4 block">{label}</strong>
            <span className="mt-1 block text-sm text-muted-foreground">
              Abrir fluxo demonstrativo
            </span>
          </Link>
        ))}
      </nav>
    </Shell>
  );
}
function DemoNotice() {
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
      <Send className="size-5 shrink-0 text-primary" />
      <p>
        Dados simulados. Não há contratação de frete, impressão, rastreamento
        externo ou movimentação real.
      </p>
    </div>
  );
}
function Shell({
  title,
  description,
  back,
  actions,
  children,
}: {
  title: string;
  description: string;
  back?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
      {back && (
        <Link
          className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground"
          href="/logistica"
        >
          <ArrowLeft className="size-4" />
          Logística
        </Link>
      )}
      <header className="mb-7 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Logística</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
function Panel({ title, action }: { title: string; action: () => void }) {
  return (
    <div className="grid min-h-64 place-items-center text-center">
      <div>
        <RefreshCw className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-3 font-semibold">{title}</h2>
        <Button className="mt-4" variant="outline" onClick={action}>
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
