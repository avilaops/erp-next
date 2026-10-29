"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Landmark,
  MonitorCheck,
  Plus,
  ReceiptText,
  Search,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Kind = "overview" | "invoices" | "nfce" | "monitor" | "guides";
type State = "ready" | "loading" | "empty" | "error" | "forbidden";
type Row = {
  id: string;
  title: string;
  detail: string;
  status: string;
  value: string;
};

const configs: Record<
  Exclude<Kind, "overview">,
  { title: string; description: string; action: string; actionHref?: string; rows: Row[] }
> = {
  invoices: {
    title: "Notas fiscais de saída",
    description:
      "Acompanhe rascunhos e situações demonstrativas de NF-e. Nenhuma emissão oficial é executada.",
    action: "Preparar nota",
    rows: [
      {
        id: "NFE-000184",
        title: "Academia Horizonte",
        detail: "Pedido PV-1048 · Série 1",
        status: "Rascunho",
        value: "R$ 18.490,00",
      },
      {
        id: "NFE-000183",
        title: "Studio Força Total",
        detail: "Pedido PV-1047 · XML demonstrativo",
        status: "Autorizada (simulação)",
        value: "R$ 7.240,00",
      },
      {
        id: "NFE-000182",
        title: "Centro Esportivo Atlas",
        detail: "Validação local pendente",
        status: "Atenção",
        value: "R$ 31.880,00",
      },
    ],
  },
  nfce: {
    title: "NFC-e",
    description:
      "Cupons associados ao PDV em ambiente exclusivamente demonstrativo, sem autorização fiscal.",
    action: "Abrir PDV",
    actionHref: "/vendas/pdv",
    rows: [
      {
        id: "NFCE-00428",
        title: "Consumidor final",
        detail: "Caixa 01 · 3 itens",
        status: "Simulada",
        value: "R$ 680,00",
      },
      {
        id: "NFCE-00427",
        title: "Consumidor identificado",
        detail: "Caixa 01 · 1 item",
        status: "Simulada",
        value: "R$ 2.490,00",
      },
      {
        id: "NFCE-00426",
        title: "Operação interrompida",
        detail: "Contingência não disponível sem backend",
        status: "Cancelada",
        value: "R$ 320,00",
      },
    ],
  },
  monitor: {
    title: "Monitor de documentos",
    description:
      "Documentos vinculados ao CNPJ em dados locais. Não há consulta aos serviços oficiais.",
    action: "Simular consulta",
    rows: [
      {
        id: "NSU-009812",
        title: "NF-e recebida de Aço Forte",
        detail: "Resumo sem XML oficial",
        status: "Ciência pendente",
        value: "Há 18 min",
      },
      {
        id: "NSU-009811",
        title: "CT-e Transportadora Rápida",
        detail: "Documento demonstrativo",
        status: "Disponível",
        value: "Hoje, 09:12",
      },
      {
        id: "NSU-009810",
        title: "NF-e Componentes Brasil",
        detail: "Evento seguro mascarado",
        status: "Manifestada",
        value: "Ontem",
      },
    ],
  },
  guides: {
    title: "Guias tributárias",
    description:
      "Organize GNRE, DARE-SP e DAS em uma agenda local, sem cálculo ou emissão oficial.",
    action: "Nova simulação",
    actionHref: "/fiscal/guias/nova",
    rows: [
      {
        id: "GUIA-091",
        title: "GNRE — SP para MG",
        detail: "Referência outubro/2026",
        status: "A revisar",
        value: "R$ 1.284,20",
      },
      {
        id: "GUIA-090",
        title: "DARE-SP — ICMS",
        detail: "Vencimento 31/10/2026",
        status: "Planejada",
        value: "R$ 4.910,00",
      },
      {
        id: "GUIA-089",
        title: "DAS",
        detail: "Competência setembro/2026",
        status: "Registrada localmente",
        value: "R$ 2.380,41",
      },
    ],
  },
};

const shortcuts = [
  ["Notas recebidas e importação de XML", "/fiscal/monitor", MonitorCheck],
  ["Configurações fiscais", "/preferencias/fiscal", FileText],
  ["DANFE de XML autorizado", "/fiscal/danfe", ReceiptText],
  ["Notas fiscais de saída", "/fiscal/notas-saida", FileText],
  ["NFC-e", "/fiscal/nfce", ReceiptText],
  ["Guias tributárias", "/fiscal/guias", Landmark],
] as const;

export function FiscalScreen({ kind }: { kind: Kind }) {
  if (kind === "overview") return <FiscalOverview />;
  return <FiscalList kind={kind} />;
}

function FiscalList({ kind }: { kind: Exclude<Kind, "overview"> }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>("ready");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(
    () =>
      config.rows.filter((row) =>
        `${row.id} ${row.title} ${row.detail} ${row.status}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
    [config.rows, query],
  );
  return (
    <Shell
      title={config.title}
      description={config.description}
      back="/fiscal"
      actions={
        <>
          {kind === "invoices" && <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/danfe">DANFE de XML autorizado</Link>}
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
          {config.actionHref ? (
            <Link className={buttonVariants()} href={config.actionHref}>
              <Plus />
              {config.action}
            </Link>
          ) : (
            <Button
              onClick={() =>
                setNotice(`${config.action}: ação preparada localmente; nenhum serviço oficial foi acessado.`)
              }
            >
              <Plus />
              {config.action}
            </Button>
          )}
        </>
      }
    >
      <Notice />
      {notice && (
        <p
          className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <label className="relative block max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar documentos</span>
            <Input
              className="pl-9"
              placeholder="Buscar número, pessoa ou situação"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {state === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Carregando documentos">
            {[1, 2, 3].map((id) => (
              <Skeleton className="h-20" key={id} />
            ))}
          </div>
        ) : state === "error" ? (
          <StatePanel
            title="Não foi possível carregar"
            description="Tente novamente; nenhuma operação fiscal foi executada."
            action={() => setState("ready")}
          />
        ) : state === "forbidden" ? (
          <StatePanel
            title="Acesso fiscal indisponível"
            description="Solicite a permissão fiscal adequada ao administrador."
          />
        ) : state === "empty" || !filtered.length ? (
          <StatePanel
            title="Nenhum documento encontrado"
            description="Altere a busca ou os filtros locais."
            action={() => {
              setQuery("");
              setState("ready");
            }}
          />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((row) => (
              <Link
                className="grid gap-3 p-4 sm:grid-cols-[120px_minmax(0,1fr)_170px_130px] sm:items-center"
                href={detailHref(kind, row.id)}
                key={row.id}
              >
                <strong className="text-sm text-primary">{row.id}</strong>
                <div>
                  <h2 className="text-sm font-medium">{row.title}</h2>
                  <p className="text-sm text-muted-foreground">{row.detail}</p>
                </div>
                <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">
                  {row.status}
                </span>
                <strong className="text-sm sm:text-right">{row.value}</strong>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function detailHref(kind: Exclude<Kind, "overview">, id: string) {
  const segment = {
    invoices: "notas-saida",
    nfce: "nfce",
    monitor: "monitor",
    guides: "guias",
  }[kind];
  return `/fiscal/${segment}/${id}`;
}

function FiscalOverview() {
  return (
    <Shell
      title="Fiscal"
      description="Configurações e documentos fiscais da empresa ativa."
    >
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Importe XMLs recebidos, consulte os documentos armazenados e prepare a configuração fiscal. A emissão de NF-e e a consulta automática à SEFAZ ainda estão indisponíveis.</p>
      <nav
        className="mt-7 grid gap-3 sm:grid-cols-2"
        aria-label="Áreas fiscais"
      >
        {shortcuts.map(([label, href, Icon]) => (
          <Link
            className="rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30"
            href={href}
            key={href}
          >
            <Icon className="size-5 text-primary" />
            <strong className="mt-4 block">{label}</strong>
            <span className="mt-1 block text-sm text-muted-foreground">
              {["/fiscal/monitor", "/preferencias/fiscal", "/fiscal/danfe"].includes(href) ? "Abrir funcionalidade" : "Abrir prévia da interface — operação ainda indisponível"}
            </span>
          </Link>
        ))}
      </nav>
    </Shell>
  );
}
function Notice() {
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground">
      <AlertTriangle className="size-5 shrink-0 text-amber-500" />
      <p>
        Ambiente de frontend. Nenhuma nota, evento, guia, XML ou consulta
        oficial é emitida, transmitida ou persistida.
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
  back?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-8 lg:px-6">
      {back && (
        <Link
          className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground"
          href={back}
        >
          <ArrowLeft className="size-4" />
          Fiscal
        </Link>
      )}
      <header className="mb-7 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Fiscal</p>
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
function StatePanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: () => void;
}) {
  return (
    <div className="grid min-h-64 place-items-center p-6 text-center">
      <div>
        <AlertTriangle className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-3 font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {action && (
          <Button className="mt-4" variant="outline" onClick={action}>
            Tentar novamente
          </Button>
        )}
      </div>
    </div>
  );
}
