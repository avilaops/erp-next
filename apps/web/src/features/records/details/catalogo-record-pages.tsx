"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  FolderTree,
  Save,
  Tags,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";

type CatalogKind = "category" | "price-list";
type FormMode = "create" | "edit";

const records = {
  category: {
    id: "CPR-002",
    title: "Bancos e suportes",
    description: "Categoria de catálogo vinculada à hierarquia de Musculação.",
    back: "/cadastros/categorias-produtos",
    editBase: "/cadastros/categorias-produtos",
    icon: FolderTree,
    fields: [
      ["Código", "CPR-002"],
      ["Categoria superior", "Musculação"],
      ["Produtos vinculados", "7 produtos"],
      ["Situação", "Ativa"],
      ["Ordem de exibição", "20"],
      ["Caminho", "Musculação > Bancos e suportes"],
    ],
  },
  "price-list": {
    id: "LST-002",
    title: "Revendedores 2026",
    description: "Tabela comercial demonstrativa para o canal de revenda.",
    back: "/cadastros/listas-precos",
    editBase: "/cadastros/listas-precos",
    icon: Tags,
    fields: [
      ["Código", "LST-002"],
      ["Aplicação", "Canal revenda"],
      ["Vigência", "01/01/2026 a 31/12/2026"],
      ["Regra principal", "Desconto de até 12%"],
      ["Itens vinculados", "128 produtos"],
      ["Situação", "Ativa"],
    ],
  },
} satisfies Record<
  CatalogKind,
  {
    id: string;
    title: string;
    description: string;
    back: string;
    editBase: string;
    icon: typeof FolderTree;
    fields: string[][];
  }
>;

export function CatalogRecordDetail({
  kind,
  id,
}: {
  kind: CatalogKind;
  id: string;
}) {
  const record = records[kind];
  const Icon = record.icon;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={record.back}
      >
        <ArrowLeft className="size-4" />
        Voltar à listagem
      </Link>
      <div className="mt-6 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow="Cadastros / Catálogo"
          title={record.title}
          description={`${record.description} Registro ${id || record.id}.`}
        />
        <Button
          nativeButton={false}
          render={
            <Link href={`${record.editBase}/${id || record.id}/editar`} />
          }
        >
          <Edit3 />
          Editar
        </Button>
      </div>
      <aside className="mt-6 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados demonstrativos da Ludus Equipamentos. Nenhuma alteração foi
        persistida.
      </aside>
      <section
        className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6"
        aria-labelledby="record-data-title"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold" id="record-data-title">
              Dados do cadastro
            </h2>
            <p className="text-sm text-muted-foreground">
              Informações usadas no catálogo comercial.
            </p>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {record.fields.map(([label, value]) => (
            <div className="rounded-xl border border-border p-4" key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-2 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export function CatalogRecordForm({
  kind,
  mode,
  id,
}: {
  kind: CatalogKind;
  mode: FormMode;
  id?: string;
}) {
  const record = records[kind];
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }
  function resetState() {
    setDirty(false);
    setSaved(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={record.back}
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm("Descartar as alterações deste cadastro?")
          )
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Voltar à listagem
      </Link>
      <div className="mt-6">
        <PageHeader
          eyebrow="Cadastros / Catálogo"
          title={
            mode === "create"
              ? kind === "category"
                ? "Nova categoria"
                : "Nova lista de preços"
              : `Editar ${record.title}`
          }
          description={`${kind === "category" ? "Organize a hierarquia usada para navegação, filtros e relatórios do catálogo." : "Defina aplicação, vigência e regras comerciais da tabela demonstrativa."}${mode === "edit" && id ? ` Registro ${id}.` : ""}`}
        />
      </div>
      <form
        className="space-y-6"
        onChange={markDirty}
        onSubmit={(event) => {
          event.preventDefault();
          setDirty(false);
          setSaved(true);
        }}
      >
        <div className="sticky top-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span
            className="mr-auto text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {saved
              ? "Cadastro salvo localmente"
              : dirty
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </span>
          <Button type="reset" variant="outline" onClick={resetState}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!dirty}>
            <Save />
            Salvar demonstração
          </Button>
        </div>
        {saved && (
          <p
            className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
            role="status"
          >
            <CheckCircle2 className="size-5 text-emerald-500" />
            Salvo apenas nesta sessão; nenhum dado foi enviado.
          </p>
        )}
        {kind === "category" ? (
          <CategoryFields mode={mode} />
        ) : (
          <PriceListFields mode={mode} />
        )}
        <aside className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
          Prévia local para validar o frontend. Vínculos, auditoria e
          persistência dependerão do backend multiempresa.
        </aside>
      </form>
    </div>
  );
}

function CategoryFields({ mode }: { mode: FormMode }) {
  const editing = mode === "edit";
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Identificação e hierarquia</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome da categoria *">
          <Input
            required
            defaultValue={editing ? "Bancos e suportes" : ""}
            placeholder="Ex.: Bancos e suportes"
          />
        </Field>
        <Field label="Código interno">
          <Input
            defaultValue={editing ? "CPR-002" : ""}
            placeholder="Gerado automaticamente"
          />
        </Field>
        <Field label="Categoria superior">
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            defaultValue={editing ? "Musculação" : "Sem categoria superior"}
          >
            <option>Sem categoria superior</option>
            <option>Musculação</option>
            <option>Bancos e suportes</option>
          </select>
        </Field>
        <Field label="Ordem de exibição">
          <Input min="0" type="number" defaultValue={editing ? "20" : "0"} />
        </Field>
        <Field className="sm:col-span-2" label="Descrição">
          <textarea
            className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm"
            defaultValue={
              editing
                ? "Equipamentos de apoio, bancos reguláveis e estruturas complementares."
                : ""
            }
          />
        </Field>
        <label className="flex items-center gap-3 rounded-xl border border-border p-4 text-sm font-medium sm:col-span-2">
          <input
            className="size-4 accent-primary"
            type="checkbox"
            defaultChecked
          />
          Categoria ativa e disponível nos filtros
        </label>
      </div>
    </section>
  );
}

function PriceListFields({ mode }: { mode: FormMode }) {
  const editing = mode === "edit";
  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Identificação e aplicação</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Nome da lista *">
            <Input
              required
              defaultValue={editing ? "Revendedores 2026" : ""}
              placeholder="Ex.: Revendedores 2027"
            />
          </Field>
          <Field label="Código interno">
            <Input
              defaultValue={editing ? "LST-002" : ""}
              placeholder="Gerado automaticamente"
            />
          </Field>
          <Field label="Aplicação *">
            <select
              required
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              defaultValue={editing ? "Canal revenda" : ""}
            >
              <option value="">Selecione</option>
              <option>Todos os clientes</option>
              <option>Canal revenda</option>
              <option>E-commerce</option>
              <option>Cliente específico</option>
            </select>
          </Field>
          <Field label="Moeda">
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
              <option>BRL — Real brasileiro</option>
            </select>
          </Field>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Vigência e regra</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Início da vigência *">
            <Input
              required
              type="date"
              defaultValue={editing ? "2026-01-01" : ""}
            />
          </Field>
          <Field label="Fim da vigência">
            <Input type="date" defaultValue={editing ? "2026-12-31" : ""} />
          </Field>
          <Field label="Ajuste percentual">
            <Input
              type="number"
              step="0.01"
              defaultValue={editing ? "-12" : "0"}
            />
          </Field>
          <Field label="Arredondamento">
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
              <option>Manter centavos</option>
              <option>Arredondar para 0,90</option>
              <option>Arredondar para inteiro</option>
            </select>
          </Field>
          <label className="flex items-center gap-3 rounded-xl border border-border p-4 text-sm font-medium sm:col-span-2">
            <input
              className="size-4 accent-primary"
              type="checkbox"
              defaultChecked
            />
            Lista ativa para novas operações
          </label>
        </div>
      </section>
    </>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`grid content-start gap-2 text-sm font-medium ${className}`}
    >
      {label}
      {children}
    </label>
  );
}
