"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Boxes,
  CheckCircle2,
  FileUp,
  Megaphone,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  Trash2,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type ScreenState = "ready" | "loading" | "empty" | "error";
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
type PageConfig = {
  title: string;
  description: string;
  action: string;
  icon: typeof ShoppingCart;
  rows: Row[];
  filters: string[];
};

const orders: Row[] = [
  {
    id: "PV-1048",
    title: "Academia Horizonte",
    subtitle: "8 itens · Vendedor: Mariana",
    value: "R$ 18.490,00",
    status: "Aguardando aprovação",
    tone: "warning",
    date: "Hoje, 10:42",
  },
  {
    id: "PV-1047",
    title: "Studio Força Total",
    subtitle: "3 itens · Loja virtual",
    value: "R$ 7.240,00",
    status: "Aprovado",
    tone: "success",
    date: "Hoje, 09:15",
  },
  {
    id: "PV-1046",
    title: "Centro Esportivo Atlas",
    subtitle: "12 itens · Vendedor: Nicolas",
    value: "R$ 31.880,00",
    status: "Em separação",
    tone: "neutral",
    date: "Ontem, 16:20",
  },
  {
    id: "PV-1045",
    title: "Cross Prime",
    subtitle: "2 itens · Marketplace",
    value: "R$ 4.760,00",
    status: "Cancelado",
    tone: "danger",
    date: "Ontem, 11:06",
  },
];

const configs: Record<string, PageConfig> = {
  pedidos: {
    title: "Pedidos de venda",
    description:
      "Acompanhe aprovação, reserva, faturamento e expedição dos pedidos.",
    action: "Novo pedido",
    icon: ShoppingCart,
    rows: orders,
    filters: [
      "Todos",
      "Aguardando aprovação",
      "Aprovado",
      "Em separação",
      "Cancelado",
    ],
  },
  propostas: {
    title: "Propostas comerciais",
    description: "Gerencie orçamentos, versões e aprovações dos clientes.",
    action: "Nova proposta",
    icon: BadgeCheck,
    filters: ["Todas", "Rascunho", "Enviada", "Aceita", "Expirada"],
    rows: [
      {
        id: "PC-382",
        title: "Arena Performance",
        subtitle: "Versão 3 · validade de 10 dias",
        value: "R$ 42.900,00",
        status: "Enviada",
        tone: "neutral",
        date: "Hoje, 08:30",
      },
      {
        id: "PC-381",
        title: "Academia Vital",
        subtitle: "Versão 1 · validade de 7 dias",
        value: "R$ 16.700,00",
        status: "Aceita",
        tone: "success",
        date: "Ontem, 14:10",
      },
      {
        id: "PC-379",
        title: "Espaço Movimento",
        subtitle: "Versão 2",
        value: "R$ 9.850,00",
        status: "Expirada",
        tone: "warning",
        date: "20 out",
      },
    ],
  },
  anuncios: {
    title: "Gestão de anúncios",
    description:
      "Organize catálogo, publicação e saúde dos anúncios por canal.",
    action: "Criar anúncio",
    icon: Megaphone,
    filters: ["Todos", "Publicado", "Pausado", "Com erro"],
    rows: [
      {
        id: "AN-210",
        title: "Leg Press 45° Profissional",
        subtitle: "Mercado Livre · SKU LP45-LD",
        value: "R$ 12.990,00",
        status: "Publicado",
        tone: "success",
        date: "Sincronizado há 8 min",
      },
      {
        id: "AN-209",
        title: "Banco Regulável Ludus",
        subtitle: "Loja própria · SKU BR-500",
        value: "R$ 2.490,00",
        status: "Publicado",
        tone: "success",
        date: "Sincronizado há 12 min",
      },
      {
        id: "AN-205",
        title: "Crossover Angular",
        subtitle: "Marketplace · SKU CA-200",
        value: "R$ 8.780,00",
        status: "Com erro",
        tone: "danger",
        date: "Falha segura: atributo obrigatório",
      },
    ],
  },
  garantias: {
    title: "Garantias",
    description:
      "Controle solicitações, prazos, análise e resolução de garantias.",
    action: "Nova solicitação",
    icon: ShieldCheck,
    filters: ["Todas", "Aberta", "Em análise", "Aprovada", "Encerrada"],
    rows: [
      {
        id: "GAR-091",
        title: "Academia Horizonte",
        subtitle: "Leg Press 45° · ruído no rolamento",
        value: "Restam 18 dias",
        status: "Em análise",
        tone: "warning",
        date: "Aberta hoje",
      },
      {
        id: "GAR-090",
        title: "Studio Fit Center",
        subtitle: "Banco regulável · estofado",
        value: "Peça enviada",
        status: "Aprovada",
        tone: "success",
        date: "Atualizada ontem",
      },
      {
        id: "GAR-087",
        title: "Box Alpha",
        subtitle: "Crossover · cabo",
        value: "Resolvida",
        status: "Encerrada",
        tone: "neutral",
        date: "18 out",
      },
    ],
  },
};

const shortcuts = [
  {
    href: "/vendas/pedidos",
    label: "Pedidos",
    description: "Aprovação e faturamento",
    icon: ShoppingCart,
  },
  {
    href: "/vendas/propostas",
    label: "Propostas",
    description: "Orçamentos e versões",
    icon: BadgeCheck,
  },
  {
    href: "/vendas/pdv",
    label: "Frente de caixa",
    description: "Venda e fechamento local",
    icon: WalletCards,
  },
  {
    href: "/vendas/anuncios",
    label: "Anúncios",
    description: "Catálogo por canal",
    icon: Megaphone,
  },
  {
    href: "/vendas/loja-virtual",
    label: "Loja virtual",
    description: "Ávila Lojas",
    icon: Store,
  },
  {
    href: "/vendas/importacao",
    label: "Importar pedidos",
    description: "Arquivos validados",
    icon: FileUp,
  },
  {
    href: "/vendas/relatorios",
    label: "Relatórios",
    description: "Indicadores comerciais",
    icon: BarChart3,
  },
  {
    href: "/vendas/garantias",
    label: "Garantias",
    description: "Prazos e solicitações",
    icon: ShieldCheck,
  },
];

export function SalesOverview() {
  return (
    <PageShell
      eyebrow="Operação comercial"
      title="Vendas"
      description="Acompanhe o funil comercial da proposta à expedição. Todos os dados desta tela são demonstrativos."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Vendas no mês"
          value="R$ 184.320"
          detail="+12,4% sobre setembro"
          tone="success"
        />
        <Metric
          label="Pedidos abertos"
          value="18"
          detail="4 aguardando aprovação"
          tone="warning"
        />
        <Metric
          label="Ticket médio"
          value="R$ 8.420"
          detail="32 pedidos faturados"
          tone="neutral"
        />
        <Metric
          label="Conversão"
          value="31,8%"
          detail="Propostas aceitas"
          tone="success"
        />
      </div>
      <section className="mt-7">
        <h2 className="text-lg font-semibold">Operação</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map(({ icon: Icon, ...item }) => (
            <Link
              className="group rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30"
              href={item.href}
              key={item.href}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <strong className="mt-4 block">{item.label}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {item.description}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-7 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="font-semibold">Pedidos recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Atualização local demonstrativa
            </p>
          </div>
          <Link
            className="text-sm font-medium text-primary"
            href="/vendas/pedidos"
          >
            Ver todos
          </Link>
        </div>
        {orders.slice(0, 3).map((row) => (
          <CompactRow key={row.id} row={row} />
        ))}
      </section>
    </PageShell>
  );
}

export function SalesList({ kind }: { kind: keyof typeof configs }) {
  const config = configs[kind];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(config.filters[0]);
  const [state, setState] = useState<ScreenState>("ready");
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
  const createLinks: Partial<Record<keyof typeof configs, string>> = {
    pedidos: "/vendas/pedidos/novo",
    propostas: "/vendas/propostas/novo",
    anuncios: "/vendas/anuncios/novo",
    garantias: "/vendas/garantias/novo",
  };
  return (
    <PageShell
      eyebrow="Vendas"
      title={config.title}
      description={config.description}
      back="/vendas"
      actions={
        <>
          <select
            aria-label="Simular estado"
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            value={state}
            onChange={(event) => setState(event.target.value as ScreenState)}
          >
            <option value="ready">Conteúdo</option>
            <option value="loading">Carregamento</option>
            <option value="empty">Vazio</option>
            <option value="error">Erro</option>
          </select>
          <Link
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href={createLinks[kind] ?? "/vendas"}
          >
            <Plus className="size-4" />
            {config.action}
          </Link>
        </>
      }
    >
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Pesquisar</span>
            <Input
              className="h-10 pl-9"
              placeholder="Pesquisar código, cliente ou item"
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
          <State
            icon={RefreshCw}
            title="Não foi possível carregar"
            description="Os dados simulados ficaram indisponíveis nesta tentativa."
          >
            <Button onClick={() => setState("ready")} variant="outline">
              Tentar novamente
            </Button>
          </State>
        )}
        {(state === "empty" ||
          (state === "ready" && filtered.length === 0)) && (
          <State
            icon={Search}
            title="Nenhum registro encontrado"
            description="Altere os filtros ou crie um novo registro."
          />
        )}
        {state === "ready" &&
          filtered.map((row) => (
            <CompactRow
              href={`/vendas/${kind}/${row.id.toLocaleLowerCase("pt-BR")}`}
              key={row.id}
              row={row}
            />
          ))}
      </section>
    </PageShell>
  );
}

export function NewSalesOrder() {
  const [items, setItems] = useState([
    { id: 1, product: "Leg Press 45° Profissional", quantity: 1, price: 12990 },
  ]);
  const [saved, setSaved] = useState(false);
  const total = items.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0,
  );
  return (
    <PageShell
      eyebrow="Vendas / Pedidos"
      title="Novo pedido de venda"
      description="Monte o pedido e revise valores. Nenhuma reserva ou cobrança real será criada."
      back="/vendas/pedidos"
    >
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
      >
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Cliente e condições</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Cliente">
              <select required defaultValue="">
                <option value="">Selecione</option>
                <option>Academia Horizonte</option>
                <option>Studio Força Total</option>
                <option>Centro Esportivo Atlas</option>
              </select>
            </Field>
            <Field label="Vendedor">
              <select defaultValue="Mariana Costa">
                <option>Mariana Costa</option>
                <option>Nicolas Ávila</option>
              </select>
            </Field>
            <Field label="Lista de preços">
              <select>
                <option>Padrão Ludus</option>
                <option>Revendedores</option>
              </select>
            </Field>
            <Field label="Forma de pagamento">
              <select>
                <option>Pix</option>
                <option>Boleto 28 dias</option>
                <option>Cartão</option>
              </select>
            </Field>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Itens</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Estoque apenas informativo nesta demonstração.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  {
                    id: Date.now(),
                    product: "Banco Regulável Ludus",
                    quantity: 1,
                    price: 2490,
                  },
                ])
              }
            >
              <Plus />
              Adicionar
            </Button>
          </div>
          <div className="mt-5 space-y-3">
            {items.map((item) => (
              <div
                className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_100px_140px] sm:items-end"
                key={item.id}
              >
                <Field label="Produto">
                  <Input
                    value={item.product}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, product: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Quantidade">
                  <Input
                    min={1}
                    type="number"
                    value={item.quantity}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, quantity: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </Field>
                <div className="pb-2 text-right">
                  <span className="text-xs text-muted-foreground">
                    Subtotal
                  </span>
                  <strong className="block">
                    {money(item.quantity * item.price)}
                  </strong>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end border-t border-border pt-5">
            <div className="text-right">
              <span className="text-sm text-muted-foreground">
                Total demonstrativo
              </span>
              <strong className="block text-2xl">{money(total)}</strong>
            </div>
          </div>
        </section>
        {saved && (
          <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span>
              Pedido salvo apenas nesta sessão. Nenhum dado foi persistido.
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            nativeButton={false}
            render={<Link href="/vendas/pedidos" />}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button type="submit">Salvar pedido local</Button>
        </div>
      </form>
    </PageShell>
  );
}

export function PosPage() {
  const [cart, setCart] = useState([
    { name: "Banco Regulável", quantity: 1, price: 2490 },
  ]);
  const [finished, setFinished] = useState(false);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  function addItem(name: string, price: number) {
    setFinished(false);
    setCart((current) => {
      const existing = current.find((item) => item.name === name);
      return existing
        ? current.map((item) => item.name === name ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { name, quantity: 1, price }];
    });
  }

  function changeQuantity(index: number, delta: number) {
    setFinished(false);
    setCart((current) => current.flatMap((item, itemIndex) => {
      if (itemIndex !== index) return [item];
      const quantity = item.quantity + delta;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  }
  return (
    <PageShell
      eyebrow="Vendas"
      title="Frente de caixa"
      description="PDV demonstrativo: venda, pagamento e fechamento permanecem locais."
      back="/vendas"
      actions={
        <>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-lg border border-input px-4 text-sm font-medium hover:bg-muted"
            href="/vendas/pdv/historico"
          >
            Histórico
          </Link>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href="/vendas/pdv/fechamento"
          >
            Fechar caixa
          </Link>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <label className="relative block">
            <span className="sr-only">Buscar ou ler código do produto</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar ou ler código do produto"
            />
          </label>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              "Leg Press 45°",
              "Banco Regulável",
              "Crossover Angular",
              "Hack Squat",
            ].map((name, index) => (
              <button
                className="rounded-xl border border-border p-4 text-left hover:border-primary/40"
                key={name}
                onClick={() => addItem(name, [12990, 2490, 8780, 9650][index])}
              >
                <Boxes className="size-5 text-primary" />
                <strong className="mt-3 block">{name}</strong>
                <span className="text-sm text-muted-foreground">
                  {money([12990, 2490, 8780, 9650][index])}
                </span>
              </button>
            ))}
          </div>
        </section>
        <aside className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Venda atual</h2>
          <div className="mt-4 divide-y divide-border">
            {cart.map((item, index) => (
              <div className="py-3" key={item.name}>
                <div className="flex items-start justify-between gap-3"><strong className="text-sm">{item.name}</strong><Button aria-label={`Remover ${item.name}`} size="icon" variant="ghost" onClick={() => changeQuantity(index, -item.quantity)}><Trash2 /></Button></div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Button aria-label={`Diminuir ${item.name}`} size="icon" variant="outline" onClick={() => changeQuantity(index, -1)}><Minus /></Button><span className="min-w-8 text-center">{item.quantity}</span><Button aria-label={`Aumentar ${item.name}`} size="icon" variant="outline" onClick={() => changeQuantity(index, 1)}><Plus /></Button></span>
                  <span>{money(item.price * item.quantity)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-between border-t border-border pt-4">
            <span>Total</span>
            <strong>
              {money(total)}
            </strong>
          </div>
          <Button className="mt-5 w-full" disabled={cart.length === 0 || finished} onClick={() => setFinished(true)}>
            Simular pagamento
          </Button>
          <Button className="mt-2 w-full" disabled={cart.length === 0} variant="ghost" onClick={() => { setCart([]); setFinished(false) }}>Limpar venda</Button>
          {finished && (
            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">
              Pagamento aprovado apenas nesta demonstração.
            </p>
          )}
        </aside>
      </div>
    </PageShell>
  );
}

export function StorePage() {
  return (
    <ChannelPage
      title="Loja virtual"
      description="Integração demonstrativa com Ávila Lojas."
      icon={Store}
      cards={[
        "Catálogo: 148 produtos",
        "Pedidos hoje: 7",
        "Sincronização: saudável",
        "Última atualização: há 4 min",
      ]}
    />
  );
}
export function ImportOrdersPage() {
  return (
    <ChannelPage
      title="Importar pedidos"
      description="Prepare arquivos para validação local. Nenhum pedido será transmitido."
      icon={FileUp}
      cards={[
        "1. Selecione CSV ou XLSX",
        "2. Mapeie as colunas",
        "3. Valide clientes e produtos",
        "4. Revise antes de importar",
      ]}
    />
  );
}
export function SalesReportsPage() {
  return (
    <ChannelPage
      title="Relatórios de vendas"
      description="Indicadores comerciais simulados, sem consolidação de backend."
      icon={BarChart3}
      cards={[
        "Curva ABC de produtos",
        "Vendas por vendedor",
        "Conversão de propostas",
        "Vendas por canal",
      ]}
    />
  );
}

function ChannelPage({
  title,
  description,
  icon: Icon,
  cards,
}: {
  title: string;
  description: string;
  icon: typeof Store;
  cards: string[];
}) {
  return (
    <PageShell
      eyebrow="Vendas"
      title={title}
      description={description}
      back="/vendas"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <section
            className="rounded-2xl border border-border bg-card p-6"
            key={card}
          >
            <Icon className="size-5 text-primary" />
            <h2 className="mt-4 font-semibold">{card}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Conteúdo demonstrativo para validar o fluxo de interface antes da
              integração.
            </p>
            <Button className="mt-5" variant="outline">
              Abrir demonstração
            </Button>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

function PageShell({
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
function CompactRow({ row, href }: { row: Row; href?: string }) {
  const tones: Record<Tone, string> = {
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    neutral: "bg-muted text-muted-foreground",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <article className="grid gap-3 border-b border-border p-4 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_160px_170px] sm:items-center sm:p-5">
      {href ? (
        <Link className="text-sm font-semibold text-primary hover:underline" href={href}>
          {row.id}
        </Link>
      ) : (
        <strong className="text-sm text-primary">{row.id}</strong>
      )}
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
    </article>
  );
}
function State({
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
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium [&_input]:h-10 [&_select]:h-10 [&_select]:rounded-lg [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:px-3 [&_select]:font-normal">
      {label}
      {children}
    </label>
  );
}
function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
