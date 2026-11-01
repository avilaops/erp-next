"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Landmark,
  Pencil,
  Save,
  Tags,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";

export type FinancialRecordKind = "accounts" | "categories" | "payments";

const configs = {
  accounts: {
    path: "contas-financeiras",
    eyebrow: "Cadastros / Contas financeiras",
    singular: "conta financeira",
    title: "Conta operacional",
    code: "CTA-001",
    icon: Landmark,
    summary: "Banco demonstrativo · agência ****",
    meta: [
      ["Tipo", "Conta bancária"],
      ["Uso", "Conta principal"],
      ["Situação", "Ativa"],
    ],
  },
  categories: {
    path: "categorias-financeiras",
    eyebrow: "Cadastros / Categorias financeiras",
    singular: "categoria financeira",
    title: "Receita de equipamentos",
    code: "CAT-001",
    icon: Tags,
    summary: "Receita > Vendas",
    meta: [
      ["Natureza", "Receita"],
      ["Categoria superior", "Vendas"],
      ["Situação", "Ativa"],
    ],
  },
  payments: {
    path: "formas-pagamento",
    eyebrow: "Cadastros / Formas de pagamento",
    singular: "forma de pagamento",
    title: "Pix",
    code: "PAG-001",
    icon: WalletCards,
    summary: "Liquidação imediata",
    meta: [
      ["Modalidade", "Pix"],
      ["Prazo", "Imediato"],
      ["Situação", "Ativa"],
    ],
  },
} as const;

export function FinancialRecordDetail({
  kind,
  recordId,
}: {
  kind: FinancialRecordKind;
  recordId: string;
}) {
  const config = configs[kind];
  const Icon = config.icon;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={`/cadastros/${config.path}`}
      >
        <ArrowLeft className="size-4" />
        Voltar para {config.path.replaceAll("-", " ")}
      </Link>
      <div className="mt-6 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow={config.eyebrow}
          title={config.title}
          description={`${config.summary}. Registro demonstrativo ${recordId}.`}
        />
        <Link
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          href={`/cadastros/${config.path}/${recordId}/editar`}
        >
          <Pencil className="size-4" />
          Editar
        </Link>
      </div>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-6" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Código</p>
            <strong>{config.code}</strong>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {config.meta.map(([label, value]) => (
            <div className="rounded-xl border border-border p-4" key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados locais demonstrativos. Nenhum saldo, lançamento ou liquidação real
        foi consultado.
      </p>
    </div>
  );
}

export function FinancialRecordForm({
  kind,
  recordId,
}: {
  kind: FinancialRecordKind;
  recordId?: string;
}) {
  const config = configs[kind];
  const editing = Boolean(recordId);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function resetState() {
    setDirty(false);
    setSaved(false);
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDirty(false);
    setSaved(true);
  }
  const back = editing
    ? `/cadastros/${config.path}/${recordId}`
    : `/cadastros/${config.path}`;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={back}
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm("Descartar as alterações deste cadastro?")
          )
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Link>
      <div className="mt-6">
        <PageHeader
          eyebrow={config.eyebrow}
          title={`${editing ? "Editar" : "Nova"} ${config.singular}`}
          description="Preencha os dados do cadastro. O salvamento permanece somente nesta demonstração."
        />
      </div>
      {saved && (
        <p
          className="mb-5 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Cadastro salvo localmente; nenhum dado foi enviado.
        </p>
      )}
      <form
        className="space-y-6"
        onChange={() => {
          setDirty(true);
          setSaved(false);
        }}
        onReset={resetState}
        onSubmit={submit}
      >
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Identificação</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Nome *">
              <Input defaultValue={editing ? config.title : ""} required />
            </Field>
            <Field label="Código">
              <Input
                defaultValue={editing ? config.code : "Gerado automaticamente"}
                disabled
              />
            </Field>
            {kind === "accounts" && (
              <>
                <Field label="Tipo de conta *">
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3"
                    defaultValue={editing ? "bank" : ""}
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="bank">Conta bancária</option>
                    <option value="cash">Caixa interno</option>
                  </select>
                </Field>
                <Field label="Banco">
                  <Input defaultValue={editing ? "Banco demonstrativo" : ""} />
                </Field>
                <Field label="Agência">
                  <Input defaultValue={editing ? "0001" : ""} />
                </Field>
                <Field label="Conta">
                  <Input defaultValue={editing ? "12345-6" : ""} />
                </Field>
              </>
            )}
            {kind === "categories" && (
              <>
                <Field label="Natureza *">
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3"
                    defaultValue={editing ? "income" : ""}
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="income">Receita</option>
                    <option value="expense">Despesa</option>
                  </select>
                </Field>
                <Field label="Categoria superior">
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3"
                    defaultValue={editing ? "sales" : ""}
                  >
                    <option value="">Nenhuma</option>
                    <option value="sales">Vendas</option>
                    <option value="production">Produção</option>
                  </select>
                </Field>
              </>
            )}
            {kind === "payments" && (
              <>
                <Field label="Modalidade *">
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3"
                    defaultValue={editing ? "pix" : ""}
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="pix">Pix</option>
                    <option value="cash">Dinheiro</option>
                    <option value="card">Cartão</option>
                    <option value="boleto">Boleto</option>
                  </select>
                </Field>
                <Field label="Prazo padrão">
                  <Input defaultValue={editing ? "Imediato" : ""} />
                </Field>
              </>
            )}
            <Field label="Situação">
              <select
                className="h-10 rounded-lg border border-input bg-background px-3"
                defaultValue="active"
              >
                <option value="active">Ativa</option>
                <option value="inactive">Inativa</option>
              </select>
            </Field>
            <Field className="sm:col-span-2" label="Observações">
              <textarea
                className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm"
                defaultValue={editing ? config.summary : ""}
              />
            </Field>
          </div>
        </section>
        <div className="sticky bottom-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
            {saved
              ? "Cadastro salvo localmente"
              : dirty
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </span>
          <Button type="reset" variant="outline">
            Cancelar
          </Button>
          <Button disabled={!dirty} type="submit">
            <Save />
            Salvar cadastro
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  className = "",
  label,
  children,
}: {
  className?: string;
  label: string;
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
