"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Factory, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialSteps = [
  { name: "Corte e preparação", status: "Concluída" },
  { name: "Soldagem estrutural", status: "Concluída" },
  { name: "Pintura", status: "Em execução" },
  { name: "Montagem final", status: "Pendente" },
  { name: "Inspeção e embalagem", status: "Pendente" },
];
const materials = [
  { sku: "INS-TUB-50", name: "Tubo aço 50 × 50 mm", planned: 54, consumed: 42 },
  { sku: "INS-CHP-06", name: "Chapa de aço 6 mm", planned: 12, consumed: 9 },
  {
    sku: "INS-PIN-PT",
    name: "Tinta eletrostática preta",
    planned: 8,
    consumed: 6,
  },
];

export function ProductionOrderDetail({ id }: { id: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/estoque/ordens-producao"
      >
        <ArrowLeft className="size-4" />
        Ordens de produção
      </Link>
      <header className="mt-6 flex flex-col gap-4 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Estoque / Produção</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Leg Press 45° — 4 unidades
          </h1>
          <p className="mt-3 text-muted-foreground">
            {id} · ordem demonstrativa em execução.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={`/estoque/ordens-producao/${id}/executar`} />}
        >
          <Play />
          Executar ordem
        </Button>
      </header>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Nenhum insumo, custo ou produto acabado será movimentado sem integração
        com o backend.
      </div>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Progresso" value="72%" />
        <Metric label="Quantidade" value="4 un." />
        <Metric label="Previsão" value="28/10/2026" />
        <Metric label="Responsável" value="Equipe Montagem A" />
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Etapas</h2>
          <ol className="mt-4 space-y-3">
            {initialSteps.map((step, index) => (
              <li className="flex items-center gap-3" key={step.name}>
                <span className="grid size-7 place-items-center rounded-full bg-muted text-xs">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm">{step.name}</span>
                <Badge value={step.status} />
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Consumo de insumos</h2>
          <div className="mt-4 divide-y divide-border">
            {materials.map((material) => (
              <div
                className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
                key={material.sku}
              >
                <div>
                  <strong>{material.name}</strong>
                  <p className="text-xs text-muted-foreground">
                    {material.sku}
                  </p>
                </div>
                <span>
                  {material.consumed} de {material.planned}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function NewProductionOrder() {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/estoque/ordens-producao"
        onClick={(event) => {
          if (dirty && !window.confirm("Descartar a nova ordem de produção?"))
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Ordens de produção
      </Link>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">Estoque / Produção</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Nova ordem de produção
        </h1>
        <p className="mt-3 text-muted-foreground">
          Planejamento demonstrativo de produto, quantidade, roteiro e
          materiais.
        </p>
      </header>
      {saved && (
        <p
          className="mt-5 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Ordem salva apenas nesta sessão.
        </p>
      )}
      <form
        className="mt-6 space-y-6"
        onChange={() => {
          setDirty(true);
          setSaved(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setDirty(false);
          setSaved(true);
        }}
      >
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Produto e planejamento</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Produto acabado *">
              <select
                required
                defaultValue=""
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione</option>
                <option>Leg Press 45°</option>
                <option>Crossover angular</option>
                <option>Banco regulável</option>
              </select>
            </Field>
            <Field label="Quantidade *">
              <Input required type="number" min="1" defaultValue="1" />
            </Field>
            <Field label="Depósito de produção *">
              <select
                required
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option>Depósito principal</option>
                <option>Produção</option>
              </select>
            </Field>
            <Field label="Conclusão prevista *">
              <Input required type="date" />
            </Field>
            <Field className="sm:col-span-2" label="Observações">
              <textarea
                className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm"
                placeholder="Instruções para a equipe"
              />
            </Field>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Roteiro padrão</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {initialSteps.map((step, index) => (
              <li
                className="flex gap-3 rounded-xl border border-border p-3 text-sm"
                key={step.name}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">
                  {index + 1}
                </span>
                {step.name}
              </li>
            ))}
          </ol>
        </section>
        <div className="sticky bottom-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
            {dirty
              ? "Alterações não salvas"
              : saved
                ? "Ordem salva localmente"
                : "Nenhuma alteração pendente"}
          </span>
          <Button
            type="reset"
            variant="outline"
            onClick={() => {
              setDirty(false);
              setSaved(false);
            }}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!dirty}>
            <Save />
            Salvar ordem
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ExecuteProductionOrder({ id }: { id: string }) {
  const [steps, setSteps] = useState(initialSteps);
  const [consumed, setConsumed] = useState(() =>
    Object.fromEntries(materials.map((item) => [item.sku, item.consumed])),
  );
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const completed = useMemo(
    () => steps.filter((step) => step.status === "Concluída").length,
    [steps],
  );
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function mark() {
    setDirty(true);
    setSaved(false);
  }
  function reset() {
    setSteps(initialSteps);
    setConsumed(
      Object.fromEntries(materials.map((item) => [item.sku, item.consumed])),
    );
    setDirty(false);
    setSaved(false);
  }
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={`/estoque/ordens-producao/${id}`}
        onClick={(event) => {
          if (dirty && !window.confirm("Descartar os apontamentos não salvos?"))
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Resumo da ordem
      </Link>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">
          Estoque / Produção / Execução
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Executar {id}
        </h1>
        <p className="mt-3 text-muted-foreground">
          Atualize etapas e consumos apenas nesta demonstração.
        </p>
      </header>
      {saved && (
        <p
          className="mt-5 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Apontamentos salvos localmente; nenhum estoque foi movimentado.
        </p>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Etapas da produção</h2>
          <div className="mt-4 space-y-3">
            {steps.map((step, index) => (
              <label
                className="grid gap-2 rounded-xl border border-border p-3 text-sm"
                key={step.name}
              >
                <span>
                  {index + 1}. {step.name}
                </span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3"
                  value={step.status}
                  onChange={(event) => {
                    setSteps((current) =>
                      current.map((item) =>
                        item.name === step.name
                          ? { ...item, status: event.target.value }
                          : item,
                      ),
                    );
                    mark();
                  }}
                >
                  <option>Pendente</option>
                  <option>Em execução</option>
                  <option>Concluída</option>
                  <option>Bloqueada</option>
                </select>
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Consumo realizado</h2>
          <div className="mt-4 space-y-3">
            {materials.map((material) => (
              <label
                className="grid gap-2 rounded-xl border border-border p-3 text-sm"
                key={material.sku}
              >
                <span>
                  <strong>{material.name}</strong>
                  <small className="ml-2 text-muted-foreground">
                    Previsto: {material.planned}
                  </small>
                </span>
                <Input
                  aria-label={`Consumo de ${material.name}`}
                  min="0"
                  type="number"
                  value={consumed[material.sku]}
                  onChange={(event) => {
                    setConsumed((current) => ({
                      ...current,
                      [material.sku]: Math.max(0, Number(event.target.value)),
                    }));
                    mark();
                  }}
                />
              </label>
            ))}
          </div>
        </section>
      </div>
      <div className="sticky bottom-20 mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <span className="mr-auto text-sm text-muted-foreground" role="status">
          {completed} de {steps.length} etapas concluídas
          {dirty ? " · alterações não salvas" : ""}
        </span>
        <Button type="button" variant="outline" onClick={reset}>
          Restaurar
        </Button>
        <Button
          type="button"
          disabled={!dirty}
          onClick={() => {
            setDirty(false);
            setSaved(true);
          }}
        >
          <Save />
          Salvar apontamentos
        </Button>
      </div>
    </div>
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
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Factory className="size-5 text-primary" />
      <strong className="mt-4 block text-xl">{value}</strong>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
function Badge({ value }: { value: string }) {
  const tone =
    value === "Concluída"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : value === "Em execução"
        ? "bg-blue-500/10 text-blue-600"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs ${tone}`}>{value}</span>
  );
}
