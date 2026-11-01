"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Pencil,
  RotateCcw,
  Save,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PeopleKind =
  | "clientes-fornecedores"
  | "vendedores"
  | "funcionarios";
export type PeopleMode = "new" | "view" | "edit";

type Value = {
  name: string;
  document: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  role: string;
  team: string;
  commission: string;
  status: "Ativo" | "Inativo" | "Revisar";
  notes: string;
};

const configs = {
  "clientes-fornecedores": {
    singular: "cliente ou fornecedor",
    title: "Clientes e fornecedores",
    icon: Building2,
    defaults: {
      name: "Academia Movimento Forte",
      document: "12.345.678/0001-90",
      email: "compras@movimentoforte.com.br",
      phone: "(17) 3422-1000",
      city: "Votuporanga",
      state: "SP",
      role: "Cliente",
      team: "Comercial",
      commission: "",
      status: "Ativo",
      notes: "Cliente de equipamentos profissionais.",
    },
  },
  vendedores: {
    singular: "vendedor",
    title: "Vendedores",
    icon: UserRound,
    defaults: {
      name: "Aline Martins",
      document: "***.***.***-18",
      email: "aline@ludus.com.br",
      phone: "(17) 99720-1144",
      city: "Votuporanga",
      state: "SP",
      role: "Vendedora",
      team: "Interior",
      commission: "2,5",
      status: "Ativo",
      notes: "Atendimento comercial no interior de São Paulo.",
    },
  },
  funcionarios: {
    singular: "funcionário",
    title: "Funcionários",
    icon: BriefcaseBusiness,
    defaults: {
      name: "Camila Souza",
      document: "***.***.***-27",
      email: "camila@ludus.com.br",
      phone: "(17) 99614-2280",
      city: "Votuporanga",
      state: "SP",
      role: "Montadora",
      team: "Produção",
      commission: "",
      status: "Ativo",
      notes: "Equipe de montagem · turno 1.",
    },
  },
} satisfies Record<
  PeopleKind,
  { singular: string; title: string; icon: typeof Building2; defaults: Value }
>;

const blank: Value = {
  name: "",
  document: "",
  email: "",
  phone: "",
  city: "",
  state: "SP",
  role: "",
  team: "",
  commission: "",
  status: "Ativo",
  notes: "",
};

export function PeopleRecord({
  kind,
  mode,
  recordId,
}: {
  kind: PeopleKind;
  mode: PeopleMode;
  recordId?: string;
}) {
  const config = configs[kind];
  const router = useRouter();
  const initial = useMemo(
    () => structuredClone(mode === "new" ? blank : config.defaults),
    [config.defaults, mode],
  );
  const [value, setValue] = useState<Value>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const Icon = config.icon;
  const basePath = `/cadastros/${kind}`;

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function leave() {
    if (!dirty || window.confirm("Descartar alterações não salvas?"))
      router.push(basePath);
  }

  function setField<K extends keyof Value>(field: K, next: Value[K]) {
    setValue((current) => ({ ...current, [field]: next }));
    setSaved(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!value.name.trim()) next.name = "Informe o nome.";
    if (value.email && !/^\S+@\S+\.\S+$/.test(value.email))
      next.email = "Informe um e-mail válido.";
    if (kind === "clientes-fornecedores" && !value.document.trim())
      next.document = "Informe CPF ou CNPJ.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaved(true);
  }

  if (mode === "view") {
    const entries = [
      ["Documento", value.document],
      ["E-mail", value.email],
      ["Telefone", value.phone],
      ["Cidade", `${value.city}/${value.state}`],
      [kind === "clientes-fornecedores" ? "Tipo" : "Função", value.role],
      ["Equipe", value.team],
      ...(value.commission ? [["Comissão", `${value.commission}%`]] : []),
      ["Situação", value.status],
    ];
    return (
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
        <Link
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          href={basePath}
        >
          <ArrowLeft className="size-4" />
          {config.title}
        </Link>
        <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-primary">
              Cadastros / {config.title}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {value.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Registro {recordId ?? "novo"} · dados demonstrativos da Ludus
              Equipamentos.
            </p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            href={`${basePath}/${recordId ?? "1"}/editar`}
          >
            <Pencil className="size-4" />
            Editar
          </Link>
        </header>
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {entries.map(([label, content]) => (
            <div
              className="rounded-xl border border-border bg-card p-4"
              key={label}
            >
              <span className="text-xs text-muted-foreground">{label}</span>
              <strong className="mt-1 block text-sm">
                {content || "Não informado"}
              </strong>
            </div>
          ))}
        </section>
        <section className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Observações</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {value.notes || "Nenhuma observação cadastrada."}
          </p>
        </section>
        <aside className="mt-6 flex gap-3 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
          <BadgeCheck className="size-5 shrink-0 text-primary" />
          Visualização local. Nenhum dado pessoal ou empresarial foi consultado
          no backend.
        </aside>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-8 lg:px-6">
      <button
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        type="button"
        onClick={leave}
      >
        <ArrowLeft className="size-4" />
        {config.title}
      </button>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">
          Cadastros / {config.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {mode === "new"
            ? `Novo ${config.singular}`
            : `Editar ${config.singular}`}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Preencha os dados operacionais. Esta etapa permanece local até a
          integração com o backend.
        </p>
      </header>
      <form className="mt-6 space-y-6" noValidate onSubmit={submit}>
        <div className="sticky top-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span
            className="mr-auto text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {saved
              ? "Alterações salvas localmente"
              : dirty
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setValue(structuredClone(initial));
              setErrors({});
              setSaved(false);
            }}
          >
            <RotateCcw />
            Restaurar
          </Button>
          <Button type="submit" disabled={!dirty}>
            <Save />
            Salvar
          </Button>
        </div>
        {saved && (
          <div
            className="flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
            role="status"
          >
            <CheckCircle2 className="size-5 text-emerald-500" />
            Salvo somente nesta demonstração; nenhum registro foi persistido.
          </div>
        )}
        <Section title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome *" error={errors.name}>
              <Input
                value={value.name}
                aria-invalid={Boolean(errors.name)}
                onChange={(event) => setField("name", event.target.value)}
              />
            </Field>
            <Field
              label={
                kind === "clientes-fornecedores"
                  ? "CPF ou CNPJ *"
                  : "CPF mascarado"
              }
              error={errors.document}
            >
              <Input
                value={value.document}
                aria-invalid={Boolean(errors.document)}
                onChange={(event) => setField("document", event.target.value)}
              />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <Input
                type="email"
                value={value.email}
                aria-invalid={Boolean(errors.email)}
                onChange={(event) => setField("email", event.target.value)}
              />
            </Field>
            <Field label="Telefone">
              <Input
                type="tel"
                value={value.phone}
                onChange={(event) => setField("phone", event.target.value)}
              />
            </Field>
          </div>
        </Section>
        <Section title="Vínculo operacional">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                kind === "clientes-fornecedores" ? "Tipo de cadastro" : "Função"
              }
            >
              <Input
                value={value.role}
                onChange={(event) => setField("role", event.target.value)}
              />
            </Field>
            <Field label="Equipe ou grupo">
              <Input
                value={value.team}
                onChange={(event) => setField("team", event.target.value)}
              />
            </Field>
            {kind === "vendedores" && (
              <Field label="Comissão (%)">
                <Input
                  inputMode="decimal"
                  value={value.commission}
                  onChange={(event) =>
                    setField("commission", event.target.value)
                  }
                />
              </Field>
            )}
            <Field label="Situação">
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                value={value.status}
                onChange={(event) =>
                  setField("status", event.target.value as Value["status"])
                }
              >
                <option>Ativo</option>
                <option>Inativo</option>
                <option>Revisar</option>
              </select>
            </Field>
          </div>
        </Section>
        <Section title="Localização e observações">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="Cidade">
              <Input
                value={value.city}
                onChange={(event) => setField("city", event.target.value)}
              />
            </Field>
            <Field label="UF">
              <Input
                maxLength={2}
                value={value.state}
                onChange={(event) =>
                  setField("state", event.target.value.toUpperCase())
                }
              />
            </Field>
            <Field className="sm:col-span-2" label="Observações">
              <textarea
                className="min-h-28 rounded-lg border border-input bg-background p-3 text-sm"
                value={value.notes}
                onChange={(event) => setField("notes", event.target.value)}
              />
            </Field>
          </div>
        </Section>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Field({
  className = "",
  label,
  error,
  children,
}: {
  className?: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`grid content-start gap-2 text-sm font-medium ${className}`}
    >
      {label}
      {children}
      {error && (
        <span className="text-sm font-normal text-destructive">{error}</span>
      )}
    </label>
  );
}
