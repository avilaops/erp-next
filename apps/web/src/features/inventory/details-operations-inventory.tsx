"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Save,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialItems = [
  { sku: "LUD-LP45", name: "Leg Press 45°", expected: 12, counted: 12 },
  { sku: "LUD-BR01", name: "Banco regulável", expected: 4, counted: 3 },
  { sku: "LUD-CR02", name: "Crossover angular", expected: 2, counted: 2 },
];

export function InventoryDetail({ id }: { id: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/estoque/inventarios"
      >
        <ArrowLeft className="size-4" />
        Inventários
      </Link>
      <header className="mt-6 flex flex-col gap-4 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">
            Estoque / Inventários
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Inventário mensal — Principal
          </h1>
          <p className="mt-3 text-muted-foreground">
            {id} · contagem demonstrativa do depósito principal.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={`/estoque/inventarios/${id}/contagem`} />}
        >
          <ClipboardCheck />
          Continuar contagem
        </Button>
      </header>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados locais. Nenhum saldo será ajustado e nenhum movimento será criado
        sem backend.
      </div>
      <section
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Indicadores do inventário"
      >
        <Metric label="Progresso" value="68%" />
        <Metric label="SKUs conferidos" value="214 de 315" />
        <Metric label="Divergências" value="7" />
        <Metric label="Responsável" value="Mariana Costa" />
      </section>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h2 className="font-semibold">Amostra da contagem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Itens que exigem conferência ou validação.
          </p>
        </div>
        <div className="divide-y divide-border">
          {initialItems.map((item) => (
            <article
              className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_120px_110px] sm:items-center"
              key={item.sku}
            >
              <div>
                <strong className="text-sm">{item.name}</strong>
                <p className="text-sm text-muted-foreground">{item.sku}</p>
              </div>
              <span className="text-sm">Esperado: {item.expected}</span>
              <span className="text-sm">Contado: {item.counted}</span>
              <Status variance={item.counted - item.expected} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function NewInventory() {
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
        href="/estoque/inventarios"
        onClick={(event) => {
          if (dirty && !window.confirm("Descartar o novo inventário?"))
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Inventários
      </Link>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">
          Estoque / Inventários
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Novo inventário
        </h1>
        <p className="mt-3 text-muted-foreground">
          Defina depósito, tipo e escopo da contagem demonstrativa.
        </p>
      </header>
      {saved && (
        <p
          className="mt-5 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Inventário preparado apenas nesta sessão; nenhum saldo foi bloqueado.
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
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Planejamento da contagem</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Depósito *">
              <select
                required
                defaultValue=""
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione</option>
                <option>Depósito principal</option>
                <option>Expedição</option>
                <option>Quarentena</option>
              </select>
            </Field>
            <Field label="Tipo de inventário *">
              <select
                required
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option>Inventário geral</option>
                <option>Contagem rotativa</option>
                <option>Conferência extraordinária</option>
              </select>
            </Field>
            <Field label="Data prevista *">
              <Input required type="date" />
            </Field>
            <Field label="Responsável">
              <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                <option>Mariana Costa</option>
                <option>Equipe de Estoque</option>
                <option>A definir</option>
              </select>
            </Field>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Escopo</h2>
          <fieldset className="mt-4 grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">Escopo da contagem</legend>
            {[
              ["all", "Todos os produtos"],
              ["category", "Por categoria"],
              ["manual", "Seleção manual"],
            ].map(([value, label], index) => (
              <label
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10"
                key={value}
              >
                <input
                  defaultChecked={index === 0}
                  name="scope"
                  type="radio"
                  value={value}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
            <input className="mt-0.5 size-4 accent-primary" type="checkbox" />
            <span>
              <strong className="block">
                Congelar movimentações durante a contagem
              </strong>
              <small className="mt-1 block text-muted-foreground">
                Somente uma configuração visual nesta fase; nenhuma operação
                será bloqueada.
              </small>
            </span>
          </label>
        </section>
        <div className="sticky bottom-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
            {saved
              ? "Inventário salvo localmente"
              : dirty
                ? "Alterações não salvas"
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
            Preparar inventário
          </Button>
        </div>
      </form>
    </div>
  );
}

export function InventoryCount({ id }: { id: string }) {
  const [items, setItems] = useState(initialItems);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [closed, setClosed] = useState(false);
  const divergences = useMemo(
    () => items.filter((item) => item.counted !== item.expected).length,
    [items],
  );

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function reset() {
    setItems(initialItems);
    setDirty(false);
    setSaved(false);
    setClosed(false);
  }
  function updateCount(sku: string, counted: number) {
    setItems((current) =>
      current.map((item) => (item.sku === sku ? { ...item, counted } : item)),
    );
    setDirty(true);
    setSaved(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href={`/estoque/inventarios/${id}`}
        onClick={(event) => {
          if (dirty && !window.confirm("Descartar as contagens não salvas?"))
            event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Resumo do inventário
      </Link>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">
          Estoque / Inventários / Contagem
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Contagem do inventário
        </h1>
        <p className="mt-3 text-muted-foreground">
          {id} · registre quantidades físicas antes da revisão final.
        </p>
      </header>
      <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground">
        <AlertTriangle className="mr-2 inline size-4 text-amber-700 dark:text-amber-300" />
        Fechar este protótipo não ajusta saldos. O fluxo apenas demonstra
        validação e confirmação.
      </div>
      {(saved || closed) && (
        <p
          className="mt-4 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          {closed
            ? "Inventário fechado somente nesta demonstração."
            : "Contagem salva somente nesta sessão."}
        </p>
      )}
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-2 border-b border-border p-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(0,1fr)_120px_150px_110px]">
          <span>Produto</span>
          <span>Esperado</span>
          <span>Contagem física</span>
          <span>Diferença</span>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div
              className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_150px_110px] sm:items-center"
              key={item.sku}
            >
              <div>
                <strong className="text-sm">{item.name}</strong>
                <p className="text-xs text-muted-foreground">{item.sku}</p>
              </div>
              <span>{item.expected} un.</span>
              <Input
                aria-label={`Contagem de ${item.name}`}
                disabled={closed}
                min="0"
                type="number"
                value={item.counted}
                onChange={(event) =>
                  updateCount(item.sku, Math.max(0, Number(event.target.value)))
                }
              />
              <Status variance={item.counted - item.expected} />
            </div>
          ))}
        </div>
      </section>
      <div className="sticky bottom-20 mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
        <span className="mr-auto text-sm text-muted-foreground" role="status">
          {closed
            ? "Inventário encerrado"
            : dirty
              ? `${divergences} divergência(s) · alterações não salvas`
              : "Contagem sincronizada localmente"}
        </span>
        <Button
          disabled={closed}
          type="button"
          variant="outline"
          onClick={reset}
        >
          Restaurar
        </Button>
        <Button
          disabled={!dirty || closed}
          type="button"
          variant="outline"
          onClick={() => {
            setDirty(false);
            setSaved(true);
          }}
        >
          <Save />
          Salvar contagem
        </Button>
        <Button
          disabled={dirty || closed}
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Fechar inventário com ${divergences} divergência(s)?`,
              )
            )
              setClosed(true);
          }}
        >
          <ClipboardCheck />
          Fechar inventário
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Warehouse className="size-5 text-primary" />
      <strong className="mt-4 block text-xl">{value}</strong>
      <span className="text-sm text-muted-foreground">{label}</span>
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
    <label className="grid content-start gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function Status({ variance }: { variance: number }) {
  return (
    <span
      className={`w-fit rounded-full px-2.5 py-1 text-xs ${variance === 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
    >
      {variance === 0
        ? "Conferido"
        : `${variance > 0 ? "+" : ""}${variance} un.`}
    </span>
  );
}
