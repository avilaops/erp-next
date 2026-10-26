"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FolderTree,
  Landmark,
  ListFilter,
  Plus,
  Search,
  Tags,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  status: "Ativo" | "Inativo" | "Revisar";
};
type Config = {
  title: string;
  description: string;
  icon: LucideIcon;
  createLabel: string;
  rows: Row[];
};
type ScreenState = "ready" | "loading" | "error" | "forbidden";

export const recordModules = [
  {
    href: "/cadastros/produtos",
    title: "Produtos",
    description: "Variantes, GTIN, NCM, imagens e preços",
    icon: Boxes,
    count: 128,
  },
  {
    href: "/cadastros/clientes-fornecedores",
    title: "Clientes e fornecedores",
    description: "Pessoas, documentos, endereços e contatos",
    icon: Building2,
    count: 84,
  },
  {
    href: "/cadastros/vendedores",
    title: "Vendedores",
    description: "Metas, comissões e vínculos empresariais",
    icon: UserRound,
    count: 6,
  },
  {
    href: "/cadastros/funcionarios",
    title: "Funcionários",
    description: "Funções, equipes e estado do acesso",
    icon: UsersRound,
    count: 19,
  },
  {
    href: "/cadastros/contas-financeiras",
    title: "Contas financeiras",
    description: "Bancos, caixas e contas internas",
    icon: Landmark,
    count: 5,
  },
  {
    href: "/cadastros/categorias-financeiras",
    title: "Categorias financeiras",
    description: "Classificação de receitas e despesas",
    icon: Tags,
    count: 18,
  },
  {
    href: "/cadastros/formas-pagamento",
    title: "Formas de pagamento",
    description: "Pix, dinheiro, cartões e boletos",
    icon: CreditCard,
    count: 7,
  },
  {
    href: "/cadastros/categorias-produtos",
    title: "Categorias de produtos",
    description: "Hierarquia e organização do catálogo",
    icon: FolderTree,
    count: 23,
  },
  {
    href: "/cadastros/listas-precos",
    title: "Listas de preços",
    description: "Vigências e regras por canal ou cliente",
    icon: WalletCards,
    count: 4,
  },
];

const configs: Record<string, Config> = {
  produtos: {
    title: "Produtos",
    description: "Gerencie o catálogo comercial e fiscal da empresa ativa.",
    icon: Boxes,
    createLabel: "Novo produto",
    rows: [
      row(
        "PRD-001",
        "Leg press 45°",
        "GTIN 7891000000012 · NCM 9506.91.00",
        "R$ 18.900,00",
        "Ativo",
      ),
      row(
        "PRD-002",
        "Crossover profissional",
        "SKU CRO-PRO · NCM 9506.91.00",
        "R$ 12.480,00",
        "Ativo",
      ),
      row(
        "PRD-003",
        "Banco regulável",
        "3 variantes · sem GTIN",
        "R$ 3.290,00",
        "Revisar",
      ),
    ],
  },
  "clientes-fornecedores": {
    title: "Clientes e fornecedores",
    description:
      "Cadastros de pessoas físicas e jurídicas, com documentos e contatos.",
    icon: Building2,
    createLabel: "Nova pessoa",
    rows: [
      row(
        "PES-001",
        "Academia Movimento Forte",
        "Cliente · CNPJ 12.***.***/0001-**",
        "Votuporanga/SP",
        "Ativo",
      ),
      row(
        "PES-002",
        "Aço Brasil Componentes",
        "Fornecedor · CNPJ 38.***.***/0001-**",
        "São José do Rio Preto/SP",
        "Ativo",
      ),
      row(
        "PES-003",
        "Marcos Oliveira",
        "Cliente · CPF ***.***.***-42",
        "Fernandópolis/SP",
        "Revisar",
      ),
    ],
  },
  vendedores: {
    title: "Vendedores",
    description: "Equipe comercial, metas e regras de comissão demonstrativas.",
    icon: UserRound,
    createLabel: "Novo vendedor",
    rows: [
      row(
        "VEN-001",
        "Aline Martins",
        "Equipe Interior · comissão 2,5%",
        "Meta R$ 180 mil",
        "Ativo",
      ),
      row(
        "VEN-002",
        "Rafael Gomes",
        "Equipe Capital · comissão 2%",
        "Meta R$ 220 mil",
        "Ativo",
      ),
      row(
        "VEN-003",
        "João Ferreira",
        "Sem equipe definida",
        "Meta pendente",
        "Revisar",
      ),
    ],
  },
  funcionarios: {
    title: "Funcionários",
    description:
      "Funções, equipes e vínculo operacional sem dados trabalhistas sensíveis.",
    icon: UsersRound,
    createLabel: "Novo funcionário",
    rows: [
      row("FUN-001", "Camila Souza", "Produção · Montagem", "Turno 1", "Ativo"),
      row(
        "FUN-002",
        "Diego Santos",
        "Logística · Expedição",
        "Turno 2",
        "Ativo",
      ),
      row(
        "FUN-003",
        "Priscila Lima",
        "Administrativo · Compras",
        "Sem acesso ao ERP",
        "Revisar",
      ),
    ],
  },
  "contas-financeiras": {
    title: "Contas financeiras",
    description:
      "Contas bancárias, caixas e contas internas; sem saldos reais.",
    icon: Landmark,
    createLabel: "Nova conta",
    rows: [
      row(
        "CTA-001",
        "Conta operacional",
        "Banco demonstrativo · agência ****",
        "Conta principal",
        "Ativo",
      ),
      row(
        "CTA-002",
        "Caixa da fábrica",
        "Conta interna",
        "Uso diário",
        "Ativo",
      ),
      row(
        "CTA-003",
        "Conta de garantia",
        "Banco demonstrativo · agência ****",
        "Revisar integração",
        "Revisar",
      ),
    ],
  },
  "categorias-financeiras": {
    title: "Categorias financeiras",
    description: "Classifique receitas e despesas na estrutura gerencial.",
    icon: Tags,
    createLabel: "Nova categoria",
    rows: [
      row(
        "CAT-001",
        "Receita de equipamentos",
        "Receita > Vendas",
        "12 lançamentos simulados",
        "Ativo",
      ),
      row(
        "CAT-002",
        "Matéria-prima",
        "Despesa > Produção",
        "28 lançamentos simulados",
        "Ativo",
      ),
      row(
        "CAT-003",
        "Despesas diversas",
        "Despesa > Sem classificação",
        "Exige revisão",
        "Revisar",
      ),
    ],
  },
  "formas-pagamento": {
    title: "Formas de pagamento",
    description: "Modalidades aceitas nas operações comerciais.",
    icon: CreditCard,
    createLabel: "Nova forma",
    rows: [
      row(
        "PAG-001",
        "Pix",
        "Liquidação imediata",
        "Disponível em vendas",
        "Ativo",
      ),
      row(
        "PAG-002",
        "Boleto bancário",
        "Vencimento configurável",
        "Disponível em vendas",
        "Ativo",
      ),
      row(
        "PAG-003",
        "Cartão em 12x",
        "Taxas ainda não configuradas",
        "Somente demonstração",
        "Revisar",
      ),
    ],
  },
  "categorias-produtos": {
    title: "Categorias de produtos",
    description: "Organize o catálogo em categorias e subcategorias.",
    icon: FolderTree,
    createLabel: "Nova categoria",
    rows: [
      row("CPR-001", "Musculação", "Categoria raiz", "18 produtos", "Ativo"),
      row(
        "CPR-002",
        "Bancos e suportes",
        "Musculação > Bancos",
        "7 produtos",
        "Ativo",
      ),
      row(
        "CPR-003",
        "Sem classificação",
        "Categoria temporária",
        "3 produtos",
        "Revisar",
      ),
    ],
  },
  "listas-precos": {
    title: "Listas de preços",
    description: "Preços por cliente, canal, empresa ou período de vigência.",
    icon: WalletCards,
    createLabel: "Nova lista",
    rows: [
      row(
        "LST-001",
        "Tabela padrão",
        "Todos os clientes",
        "Vigência contínua",
        "Ativo",
      ),
      row(
        "LST-002",
        "Revendedores 2026",
        "Canal revenda · desconto até 12%",
        "Até 31/12/2026",
        "Ativo",
      ),
      row(
        "LST-003",
        "Campanha de verão",
        "E-commerce · desconto até 8%",
        "Vigência encerrada",
        "Inativo",
      ),
    ],
  },
};

function row(
  id: string,
  title: string,
  subtitle: string,
  meta: string,
  status: Row["status"],
): Row {
  return { id, title, subtitle, meta, status };
}

export function RecordsOverview() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 lg:px-6">
      <PageHeader
        eyebrow="Cadastros"
        title="Central de cadastros"
        description="Registros fundamentais compartilhados pelos módulos do ERP."
      />
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados demonstrativos da Ludus Equipamentos. Nenhuma alteração é
        persistida sem backend.
      </div>
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Áreas de cadastros"
      >
        {recordModules.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className="group rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40 hover:bg-muted/30"
              href={item.href}
              key={item.href}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <div className="mt-5 flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <strong className="block text-base">{item.title}</strong>
                  <small className="mt-1 block text-sm leading-5 text-muted-foreground">
                    {item.description}
                  </small>
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {item.count} registros simulados
              </p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

export function RecordsList({ module }: { module: keyof typeof configs }) {
  const config = configs[module];
  const Icon = config.icon;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const [screen, setScreen] = useState<ScreenState>("ready");
  const [message, setMessage] = useState("");
  const [pageSize, setPageSize] = useState("25");
  const filtered = useMemo(
    () =>
      config.rows.filter(
        (item) =>
          `${item.title} ${item.subtitle} ${item.id}`
            .toLocaleLowerCase("pt-BR")
            .includes(query.toLocaleLowerCase("pt-BR")) &&
          (status === "Todos" || item.status === status),
      ),
    [config.rows, query, status],
  );
  const createHref = `/cadastros/${module}/novo`;
  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 lg:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader
          eyebrow="Cadastros"
          title={config.title}
          description={config.description}
        />
        <div className="mb-8 flex flex-wrap gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Simular estado
            <select
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={screen}
              onChange={(event) => setScreen(event.target.value as ScreenState)}
            >
              <option value="ready">Conteúdo</option>
              <option value="loading">Carregamento</option>
              <option value="error">Erro</option>
              <option value="forbidden">Sem permissão</option>
            </select>
          </label>
          <Link
            className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={createHref}
          >
            <Plus />
            {config.createLabel}
          </Link>
        </div>
      </div>
      {message && (
        <p
          className="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm"
          role="status"
        >
          {message}
        </p>
      )}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(240px,1fr)_180px_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Buscar em {config.title}</span>
            <Input
              className="h-10 pl-9"
              type="search"
              placeholder="Buscar por código, nome ou documento"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setMessage(
                  "Importação preparada apenas na interface; nenhum arquivo foi enviado.",
                )
              }
            >
              <Upload />
              Importar
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setMessage(
                  "Exportação preparada apenas na interface; nenhum arquivo foi gerado.",
                )
              }
            >
              <Download />
              Exportar
            </Button>
          </div>
          <label className="relative">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Filtrar por estado</span>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>Ativo</option>
              <option>Inativo</option>
              <option>Revisar</option>
            </select>
          </label>
        </div>
        {screen === "loading" ? (
          <div
            className="space-y-3 p-5"
            aria-label={`Carregando ${config.title}`}
          >
            {[1, 2, 3].map((item) => (
              <Skeleton className="h-20 w-full rounded-xl" key={item} />
            ))}
          </div>
        ) : screen === "error" ? (
          <State
            icon={AlertCircle}
            title="Não foi possível carregar os registros"
            description="Tente novamente. Nenhuma alteração foi perdida."
          >
            <Button variant="outline" onClick={() => setScreen("ready")}>
              Tentar novamente
            </Button>
          </State>
        ) : screen === "forbidden" ? (
          <State
            icon={AlertCircle}
            title="Acesso aos cadastros restrito"
            description="Solicite a permissão adequada ao administrador da empresa."
          />
        ) : filtered.length ? (
          <div className="divide-y divide-border">
            {filtered.map((item) => (
              <article
                className="grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_180px_auto] sm:items-center sm:px-5"
                key={item.id}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">
                    <Link
                      className="hover:text-primary hover:underline"
                      href={`/cadastros/${module}/${item.id}`}
                    >
                      {item.title}
                    </Link>
                  </h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {item.id} · {item.subtitle}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">{item.meta}</p>
                <span
                  className={`w-fit rounded-full border px-2.5 py-1 text-xs ${item.status === "Ativo" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : item.status === "Revisar" ? "border-amber-500/20 bg-amber-500/10 text-amber-500" : "border-border bg-muted text-muted-foreground"}`}
                >
                  {item.status}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <State
            icon={Search}
            title="Nenhum registro encontrado"
            description="Revise os filtros ou o termo pesquisado."
          >
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setStatus("Todos");
              }}
            >
              Limpar filtros
            </Button>
          </State>
        )}
        {screen === "ready" && filtered.length > 0 && (
          <footer className="flex flex-col gap-3 border-t border-border p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Exibindo 1–{filtered.length} de {filtered.length} registros
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2">
                Por página
                <select
                  className="h-9 rounded-lg border border-input bg-background px-2 text-foreground"
                  value={pageSize}
                  onChange={(event) => setPageSize(event.target.value)}
                >
                  <option>25</option>
                  <option>50</option>
                  <option>100</option>
                </select>
              </label>
              <Button
                aria-label="Página anterior"
                disabled
                size="icon"
                variant="outline"
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-16 text-center text-foreground">
                Página 1
              </span>
              <Button
                aria-label="Próxima página"
                disabled
                size="icon"
                variant="outline"
              >
                <ChevronRight />
              </Button>
            </div>
          </footer>
        )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">
        Pesquisa, filtros e paginação usam dados locais demonstrativos.
        Importação, exportação e exclusão dependerão dos contratos de backend,
        tenant e auditoria.
      </p>
    </div>
  );
}

function State({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center p-6 text-center">
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
