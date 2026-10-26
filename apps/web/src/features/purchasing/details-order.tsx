"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleX, Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailCard, Fact, PurchasingDetailShell } from "./details-shell";

type Order = {
  supplier: string;
  delivery: string;
  status: "Em aprovação" | "Aprovado" | "Reprovado";
  notes: string;
  quantity: number;
  price: number;
};
const initialOrder: Order = {
  supplier: "Aço Rio Preto",
  delivery: "2026-10-28",
  status: "Em aprovação",
  notes: "Entregar na doca 02 durante o horário comercial.",
  quantity: 54,
  price: 82.5,
};

export function PurchaseOrderDetail({ id }: { id: string }) {
  const [status, setStatus] = useState<Order["status"]>(initialOrder.status);
  const [notice, setNotice] = useState("");
  const code = id.toUpperCase();
  function decide(next: Order["status"]) {
    setStatus(next);
    setNotice(
      `${code} marcado como ${next.toLocaleLowerCase("pt-BR")} apenas nesta demonstração.`,
    );
  }
  return (
    <PurchasingDetailShell
      back="/compras/pedidos"
      eyebrow="Compras / Pedidos"
      title={code}
      description="Detalhes, itens e aprovação local do pedido de compra."
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => decide("Reprovado")}
            disabled={status === "Reprovado"}
          >
            <CircleX />
            Reprovar
          </Button>
          <Button
            onClick={() => decide("Aprovado")}
            disabled={status === "Aprovado"}
          >
            <CheckCircle2 />
            Aprovar
          </Button>
          <Link
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm font-medium hover:bg-muted"
            href={`/compras/pedidos/${id}/editar`}
          >
            <Pencil className="size-4" />
            Editar
          </Link>
        </>
      }
    >
      {notice && (
        <p
          className="mt-6 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DetailCard title="Itens">
          <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_100px_140px]">
            <div>
              <strong className="text-sm">Tubo aço 50 × 50 mm</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                SKU MP-ACO-5050
              </p>
            </div>
            <span className="text-sm">54 unidades</span>
            <strong className="text-sm sm:text-right">R$ 4.455,00</strong>
          </div>
        </DetailCard>
        <DetailCard title="Resumo">
          <dl className="grid gap-4">
            <Fact label="Fornecedor" value={initialOrder.supplier} />
            <Fact label="Entrega prevista" value="28/10/2026" />
            <Fact label="Situação" value={status} />
            <Fact label="Total" value="R$ 4.455,00" />
          </dl>
        </DetailCard>
      </div>
      <DetailCard className="mt-5" title="Observações">
        <p className="text-sm text-muted-foreground">{initialOrder.notes}</p>
      </DetailCard>
      <p className="mt-5 text-xs text-muted-foreground">
        Aprovação, reprovação e edição são locais. Nenhum pedido foi enviado ao
        fornecedor.
      </p>
    </PurchasingDetailShell>
  );
}

export function PurchaseOrderEdit({ id }: { id: string }) {
  const initial = useMemo(() => structuredClone(initialOrder), []);
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function setField<K extends keyof Order>(field: K, next: Order[K]) {
    setValue((current) => ({ ...current, [field]: next }));
    setSaved(false);
  }
  return (
    <PurchasingDetailShell
      back={`/compras/pedidos/${id}`}
      eyebrow="Compras / Pedidos"
      title={`Editar ${id.toUpperCase()}`}
      description="Atualize o pedido demonstrativo sem transmitir dados ao fornecedor."
    >
      <form
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(true);
        }}
      >
        <div className="sticky top-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
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
        <DetailCard title="Fornecedor e entrega">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fornecedor">
              <select
                className="h-10 rounded-lg border border-input bg-background px-3"
                value={value.supplier}
                onChange={(event) => setField("supplier", event.target.value)}
              >
                <option>Aço Rio Preto</option>
                <option>Componentes Atlas</option>
              </select>
            </Field>
            <Field label="Entrega prevista">
              <Input
                type="date"
                value={value.delivery}
                onChange={(event) => setField("delivery", event.target.value)}
              />
            </Field>
            <Field label="Quantidade">
              <Input
                min={1}
                type="number"
                value={value.quantity}
                onChange={(event) =>
                  setField("quantity", Number(event.target.value))
                }
              />
            </Field>
            <Field label="Preço unitário">
              <Input
                min={0}
                step="0.01"
                type="number"
                value={value.price}
                onChange={(event) =>
                  setField("price", Number(event.target.value))
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
        </DetailCard>
        {saved && (
          <p
            className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
            role="status"
          >
            Pedido salvo somente nesta sessão.
          </p>
        )}
      </form>
    </PurchasingDetailShell>
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
    <label className={`grid gap-2 text-sm font-medium ${className}`}>
      {label}
      {children}
    </label>
  );
}
