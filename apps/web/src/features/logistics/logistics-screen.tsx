"use client";
import { PageTitle } from "@/components/workspace/page-title"

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { erpFetch } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/error-message";

type Kind =
  | "overview"
  | "postings"
  | "returns"
  | "checkout"
  | "labels"
  | "shipping";
const unavailableTitles = {
  returns: "Logística reversa",
  checkout: "Checkout de pedidos",
  labels: "Impressão de etiquetas",
  shipping: "Ávila Envios",
} as const;

const shortcuts = [
  ["Postagens", "/logistica/postagens", PackageCheck],
  ["Logística reversa", "/logistica/reversa", RotateCcw],
  ["Checkout", "/logistica/checkout", CheckCircle2],
  ["Etiquetas", "/logistica/etiquetas", Printer],
  ["Ávila Envios", "/logistica/envios", Truck],
] as const;

export function LogisticsScreen({ kind }: { kind: Kind }) {
  if (kind === "overview") return <Overview />;
  if (kind === "postings") return <PostingList />;
  if (kind === "checkout") return <CheckoutList />;
  if (kind === "labels") return <LabelList />;
  if (kind === "returns") return <ReverseList />;
  return <LogisticsList kind={kind} />;
}

function LogisticsList({ kind }: { kind: Exclude<Kind, "overview" | "postings"> }) {
  return <CapabilityUnavailable title={unavailableTitles[kind]} />;
}

export function CapabilityUnavailable({ title }: { title: string }) {
  return (
    <Shell
      title={title}
      description="Este módulo já está disponível na navegação, mas ainda não possui um contrato de backend persistente nesta empresa."
      back
    >
      <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold">Integração pendente</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Nenhuma operação será criada, impressa, contratada ou enviada por esta tela até que a API, as permissões e a persistência sejam implementadas.
        </p>
        <Link className="mt-5 inline-flex text-sm font-medium text-primary hover:underline" href="/logistica">
          Voltar para Logística
        </Link>
      </section>
    </Shell>
  );
}

type Posting = {
  id: string;
  code: string;
  recipientName: string;
  service: string;
  destinationCity: string;
  destinationState: string;
  packageCount: number;
  weightGrams: number;
  declaredValueCents: number;
  trackingCode: string | null;
  status: "prepared" | "posted" | "in_transit" | "delivered" | "cancelled";
};

function PostingList() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ data: Posting[]; tenantId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: "50", offset: String(offset) });
    erpFetch(`/api/erp/logistics/postings?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) {
          const failure = new Error(value.title || "Postagens indisponíveis");
          (failure as Error & { status?: number }).status = response.status;
          throw failure;
        }
        if (!controller.signal.aborted) { setResult(value); setError(""); }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(apiErrorMessage(reason, "Postagens indisponíveis"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, offset, retry]);

  const forbidden = error.includes("permiss") || error.includes("restrito");
  return (
    <Shell title="Objetos de postagem" description="Postagens da empresa ativa, com volumes, destino, rastreio e situação operacional." back actions={<Button nativeButton={false} render={<Link href="/logistica/postagens/novo" />}><Plus />Nova postagem</Button>}>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4"><label className="relative block max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Pesquisar postagens</span><Input className="pl-9" placeholder="Buscar código, destinatário ou cidade" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} /></label></div>
        {loading ? <div className="space-y-3 p-5" aria-label="Carregando postagens">{[1, 2, 3].map((id) => <Skeleton className="h-20" key={id} />)}</div> : error ? <Panel title={forbidden ? "Acesso às postagens restrito" : "Não foi possível carregar as postagens"} action={() => setRetry((value) => value + 1)} /> : !result?.data.length ? <Panel title="Nenhuma postagem encontrada" action={() => { setQuery(""); setOffset(0); setRetry((value) => value + 1); }} /> : <><div className="divide-y divide-border">{result.data.map((posting) => <article className="grid gap-3 p-4 sm:grid-cols-[140px_minmax(0,1fr)_170px] sm:items-center" key={posting.id}><Link className="text-sm font-semibold text-primary hover:underline" href={`/logistica/postagens/${posting.id}`}>{posting.code}</Link><div><h2 className="text-sm font-medium">{posting.recipientName}</h2><p className="text-sm text-muted-foreground">{posting.destinationCity} / {posting.destinationState} · {posting.packageCount} volume(s) · {posting.trackingCode || posting.service}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{postingStatus(posting.status)}</span></article>)}</div><div className="flex items-center justify-between gap-3 border-t border-border p-4"><Button variant="outline" disabled={!offset || loading} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Anterior</Button><span className="text-sm text-muted-foreground">Página {offset / 50 + 1}</span><Button variant="outline" disabled={loading || result.data.length < 50} onClick={() => setOffset((value) => value + 50)}>Próxima</Button></div></>}
      </section>
    </Shell>
  );
}

function postingStatus(status: Posting["status"]) {
  return { prepared: "Preparado", posted: "Postado", in_transit: "Em trânsito", delivered: "Entregue", cancelled: "Cancelado" }[status];
}

type CheckoutSummary = { id: string; orderId: string; status: "counting" | "completed" | "cancelled"; revision: number };

function CheckoutList() {
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [items, setItems] = useState<CheckoutSummary[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    erpFetch("/api/erp/logistics/checkouts", { signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Checkouts indisponíveis");
      setItems(value.data); setTenantId(value.tenantId); setError("");
    }).catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Checkouts indisponíveis")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting || !tenantId || !orderId.trim()) return;
    setStarting(true); setError("");
    try {
      const response = await erpFetch("/api/erp/logistics/checkouts", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ orderId: orderId.trim() }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível iniciar o checkout");
      router.push(`/logistica/checkout/${value.data.id}`);
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível iniciar o checkout")); } finally { setStarting(false); }
  }
  return <Shell title="Checkout de pedidos" description="Confira as linhas de um pedido confirmado antes da expedição." back actions={<form className="flex flex-wrap gap-2" onSubmit={start}><Input aria-label="UUID do pedido" placeholder="UUID do pedido" value={orderId} onChange={(event) => setOrderId(event.target.value)} /><Button disabled={starting || loading || !tenantId} type="submit"><Plus />{starting ? "Iniciando…" : "Iniciar conferência"}</Button></form>}>
    {error && <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><span>{error}</span><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button></div>}
    <section className="overflow-hidden rounded-2xl border border-border bg-card">{loading ? <div className="space-y-3 p-5" role="status"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : !items.length ? <div className="grid min-h-64 place-items-center p-5 text-center"><div><CheckCircle2 className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 font-semibold">Nenhum checkout iniciado</h2><p className="mt-2 text-sm text-muted-foreground">Informe o UUID de um pedido confirmado para começar.</p></div></div> : <div className="divide-y divide-border">{items.map((item) => <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_160px_120px] sm:items-center" key={item.id}><div><Link className="text-sm font-semibold text-primary hover:underline" href={`/logistica/checkout/${item.id}`}>{item.orderId}</Link><p className="text-xs text-muted-foreground">Checkout {item.id}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{checkoutStatus(item.status)}</span><Link className="text-sm text-primary hover:underline" href={`/logistica/checkout/${item.id}`}>Abrir</Link></article>)}</div>}</section>
  </Shell>;
}

function checkoutStatus(status: CheckoutSummary["status"]) {
  return { counting: "Em conferência", completed: "Concluído", cancelled: "Cancelado" }[status];
}

type LabelJob = { id: string; checkoutId: string; packageId: string; packageNumber: number; labelCode: string | null; status: "queued" | "printed" | "failed"; createdAt: string };

function LabelList() {
  const [items, setItems] = useState<LabelJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    erpFetch("/api/erp/logistics/labels", { signal: controller.signal }).then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.title || "Fila de etiquetas indisponível"); setItems(value.data); setError(""); }).catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Fila de etiquetas indisponível")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  return <Shell title="Impressão de etiquetas" description="Fila persistida de etiquetas geradas a partir dos volumes etiquetados." back><section className="overflow-hidden rounded-2xl border border-border bg-card">{loading ? <div className="space-y-3 p-5" role="status"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : error ? <Panel title={error} action={() => setRetry((value) => value + 1)} /> : !items.length ? <div className="grid min-h-64 place-items-center p-5 text-center"><div><Printer className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 font-semibold">Fila vazia</h2><p className="mt-2 text-sm text-muted-foreground">Gere etiquetas dentro de um checkout com volumes etiquetados.</p></div></div> : <div className="divide-y divide-border">{items.map((item) => <article className="grid gap-3 p-4 sm:grid-cols-[100px_minmax(0,1fr)_140px] sm:items-center" key={item.id}><strong>Vol. {item.packageNumber}</strong><div><p className="text-sm font-medium">{item.labelCode || "Sem código de etiqueta"}</p><p className="text-xs text-muted-foreground">Checkout {item.checkoutId}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{item.status === "queued" ? "Na fila" : item.status === "printed" ? "Impressa" : "Falha"}</span></article>)}</div>}</section></Shell>;
}

type ReverseCase = {
  id: string;
  protocol: string;
  title: string;
  criticality: string;
  status: string;
  coverageStatus: string;
  updatedAt: string;
};

function ReverseList() {
  const [cases, setCases] = useState<ReverseCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    erpFetch("/api/erp/warranty-cases", { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.title || "Solicitações de reversa indisponíveis");
        setCases(value.data || []);
        setError("");
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Solicitações de reversa indisponíveis")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  return <Shell title="Logística reversa" description="Protocolos de garantia que podem gerar RMA, retorno de produto e tratamento reverso." back actions={<Link className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90" href="/vendas/garantias">Nova solicitação</Link>}>
    <div className="mb-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">A autorização de retorno nasce no protocolo de garantia. O RMA, a quarentena e as movimentações reversas ficam registrados no atendimento original.</div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {loading ? <div className="space-y-3 p-5"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : error ? <Panel title="Não foi possível carregar as solicitações" action={() => { setLoading(true); setRetry((value) => value + 1); }} /> : !cases.length ? <Panel title="Nenhuma solicitação encontrada" action={() => undefined} /> : <div className="divide-y divide-border">{cases.map((item) => <article className="grid gap-3 p-4 sm:grid-cols-[150px_minmax(0,1fr)_170px] sm:items-center" key={item.id}><Link className="text-sm font-semibold text-primary hover:underline" href={`/vendas/garantias/${item.id}`}>{item.protocol}</Link><div><h2 className="text-sm font-medium">{item.title}</h2><p className="text-sm text-muted-foreground">Criticidade: {item.criticality} · Cobertura: {item.coverageStatus} · Atualizado em {new Date(item.updatedAt).toLocaleDateString("pt-BR")}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{reverseStatus(item.status)}</span></article>)}</div>}
    </section>
  </Shell>;
}

function reverseStatus(status: string) {
  return { opened: "Aberta", triage: "Triagem", diagnosis: "Diagnóstico", treatment: "Tratamento", resolved: "Resolvida", closed: "Encerrada", cancelled: "Cancelada" }[status] || status;
}

function Overview() {
  return (
    <Shell
      title="Logística"
      description="Expedição, conferência, etiquetas, rastreamento e devoluções da empresa ativa."
    >
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
              Abrir módulo operacional
            </span>
          </Link>
        ))}
      </nav>
    </Shell>
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
          <PageTitle className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </PageTitle>
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
