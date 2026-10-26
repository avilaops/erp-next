"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  MapPin,
  Pencil,
  Save,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";

const movementData: Record<
  string,
  {
    title: string;
    type: string;
    quantity: string;
    origin: string;
    destination: string;
    reference: string;
  }
> = {
  "MOV-01842": {
    title: "Entrada de recebimento",
    type: "Entrada",
    quantity: "+24 un.",
    origin: "Recebimento PC-00482",
    destination: "Depósito principal",
    reference: "Pedido PC-00482",
  },
  "MOV-01841": {
    title: "Reserva de venda",
    type: "Saída",
    quantity: "-2 un.",
    origin: "Expedição",
    destination: "Pedido PV-10438",
    reference: "Pedido PV-10438",
  },
  "MOV-01840": {
    title: "Transferência interna",
    type: "Transferência",
    quantity: "8 un.",
    origin: "Depósito principal",
    destination: "Expedição",
    reference: "Transferência interna",
  },
};

const warehouseData: Record<
  string,
  {
    title: string;
    location: string;
    occupancy: string;
    status: string;
    zones: string;
  }
> = {
  "DEP-01": {
    title: "Depósito principal",
    location: "Votuporanga/SP",
    occupancy: "76%",
    status: "Ativo",
    zones: "28 localizações",
  },
  "DEP-02": {
    title: "Expedição",
    location: "Votuporanga/SP",
    occupancy: "64%",
    status: "Ativo",
    zones: "8 localizações",
  },
  "DEP-03": {
    title: "Quarentena",
    location: "Votuporanga/SP",
    occupancy: "12 itens",
    status: "Restrito",
    zones: "6 localizações",
  },
};

export function MovementDetail({ movementId }: { movementId: string }) {
  const item = movementData[movementId] ?? movementData["MOV-01842"];
  return (
    <DetailShell
      back="/estoque/lancamentos"
      eyebrow="Estoque / Movimentações"
      title={item.title}
      description={`Lançamento demonstrativo ${movementId}. Nenhum saldo real foi alterado.`}
      icon={ArrowRightLeft}
    >
      <InfoGrid
        items={[
          ["Tipo", item.type],
          ["Quantidade", item.quantity],
          ["Origem", item.origin],
          ["Destino", item.destination],
          ["Referência", item.reference],
          ["Situação", "Confirmado localmente"],
        ]}
      />
    </DetailShell>
  );
}

export function MovementForm() {
  return (
    <ProtectedForm
      back="/estoque/lancamentos"
      eyebrow="Estoque / Movimentações"
      title="Novo lançamento de estoque"
      description="Registre uma entrada, saída, transferência ou ajuste apenas nesta demonstração."
    >
      <Field label="Tipo de movimento *">
        <select
          className="h-10 rounded-lg border border-input bg-background px-3"
          defaultValue=""
          required
        >
          <option value="">Selecione</option>
          <option>Entrada</option>
          <option>Saída</option>
          <option>Transferência</option>
          <option>Ajuste</option>
        </select>
      </Field>
      <Field label="Produto *">
        <select
          className="h-10 rounded-lg border border-input bg-background px-3"
          defaultValue=""
          required
        >
          <option value="">Selecione</option>
          <option>Leg Press 45°</option>
          <option>Banco regulável</option>
          <option>Crossover angular</option>
        </select>
      </Field>
      <Field label="Quantidade *">
        <Input min="1" type="number" required />
      </Field>
      <Field label="Unidade">
        <Input defaultValue="UN" disabled />
      </Field>
      <Field label="Depósito de origem">
        <select className="h-10 rounded-lg border border-input bg-background px-3">
          <option>Depósito principal</option>
          <option>Expedição</option>
          <option>Quarentena</option>
        </select>
      </Field>
      <Field label="Depósito de destino">
        <select className="h-10 rounded-lg border border-input bg-background px-3">
          <option>Expedição</option>
          <option>Depósito principal</option>
          <option>Quarentena</option>
        </select>
      </Field>
      <Field className="sm:col-span-2" label="Motivo ou referência *">
        <Input placeholder="Pedido, inventário ou justificativa" required />
      </Field>
      <Field className="sm:col-span-2" label="Observações">
        <textarea className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm" />
      </Field>
    </ProtectedForm>
  );
}

export function WarehouseDetail({ warehouseId }: { warehouseId: string }) {
  const item = warehouseData[warehouseId] ?? warehouseData["DEP-01"];
  return (
    <DetailShell
      back="/estoque/depositos"
      edit={`/estoque/depositos/${warehouseId}/editar`}
      eyebrow="Estoque / Depósitos"
      title={item.title}
      description={`Estrutura demonstrativa ${warehouseId}, sem vínculo com saldos reais.`}
      icon={Warehouse}
    >
      <InfoGrid
        items={[
          ["Localização", item.location],
          ["Ocupação", item.occupancy],
          ["Situação", item.status],
          ["Endereços", item.zones],
          ["Empresa", "Ludus Equipamentos"],
          ["Responsável", "Mariana Costa"],
        ]}
      />
      <section className="mt-5 rounded-2xl border border-border p-5">
        <h2 className="font-semibold">Localizações internas</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            "A-01 · Equipamentos",
            "B-04 · Componentes",
            "EXP-02 · Separação",
          ].map((zone) => (
            <div
              className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm"
              key={zone}
            >
              <MapPin className="size-4 text-primary" />
              {zone}
            </div>
          ))}
        </div>
      </section>
    </DetailShell>
  );
}

export function WarehouseForm({ warehouseId }: { warehouseId?: string }) {
  const item = warehouseId
    ? (warehouseData[warehouseId] ?? warehouseData["DEP-01"])
    : undefined;
  const editing = Boolean(warehouseId);
  return (
    <ProtectedForm
      back={
        editing ? `/estoque/depositos/${warehouseId}` : "/estoque/depositos"
      }
      eyebrow="Estoque / Depósitos"
      title={editing ? `Editar ${item?.title}` : "Novo depósito"}
      description="Configure o armazém e suas regras operacionais somente nesta demonstração."
    >
      <Field label="Nome *">
        <Input defaultValue={item?.title ?? ""} required />
      </Field>
      <Field label="Código">
        <Input
          defaultValue={warehouseId ?? "Gerado automaticamente"}
          disabled
        />
      </Field>
      <Field label="Cidade *">
        <Input defaultValue={item ? "Votuporanga" : ""} required />
      </Field>
      <Field label="UF *">
        <select
          className="h-10 rounded-lg border border-input bg-background px-3"
          defaultValue="SP"
          required
        >
          <option>SP</option>
          <option>MG</option>
          <option>PR</option>
        </select>
      </Field>
      <Field label="Tipo">
        <select className="h-10 rounded-lg border border-input bg-background px-3">
          <option>Armazenamento</option>
          <option>Expedição</option>
          <option>Quarentena</option>
        </select>
      </Field>
      <Field label="Situação">
        <select
          className="h-10 rounded-lg border border-input bg-background px-3"
          defaultValue={item?.status === "Restrito" ? "Restrito" : "Ativo"}
        >
          <option>Ativo</option>
          <option>Restrito</option>
          <option>Inativo</option>
        </select>
      </Field>
      <Field className="sm:col-span-2" label="Endereço">
        <Input placeholder="Endereço operacional do depósito" />
      </Field>
      <Field className="sm:col-span-2" label="Observações">
        <textarea
          className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm"
          defaultValue={item?.zones ?? ""}
        />
      </Field>
    </ProtectedForm>
  );
}

function ProtectedForm({
  back,
  eyebrow,
  title,
  description,
  children,
}: {
  back: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={back}
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm("Descartar as alterações deste formulário?")
          )
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Link>
      <div className="mt-6">
        <PageHeader eyebrow={eyebrow} title={title} description={description} />
      </div>
      {saved && (
        <p
          className="mb-5 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Registro salvo localmente. Nenhum saldo foi persistido.
        </p>
      )}
      <form
        className="space-y-6"
        onChange={() => {
          setDirty(true);
          setSaved(false);
        }}
        onReset={() => {
          setDirty(false);
          setSaved(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setDirty(false);
          setSaved(true);
        }}
      >
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Dados operacionais</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
        </section>
        <div className="sticky bottom-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
            {saved
              ? "Salvo localmente"
              : dirty
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </span>
          <Button type="reset" variant="outline">
            Cancelar
          </Button>
          <Button disabled={!dirty} type="submit">
            <Save />
            Salvar demonstração
          </Button>
        </div>
      </form>
    </div>
  );
}

function DetailShell({
  back,
  edit,
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
}: {
  back: string;
  edit?: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Warehouse;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={back}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Link>
      <header className="mt-6 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-muted-foreground">{description}</p>
        </div>
        {edit && (
          <Link
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            href={edit}
          >
            <Pencil className="size-4" />
            Editar
          </Link>
        )}
      </header>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-6" />
        </span>
        {children}
      </section>
    </div>
  );
}

function InfoGrid({ items }: { items: string[][] }) {
  return (
    <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div className="rounded-xl border border-border p-4" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
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
