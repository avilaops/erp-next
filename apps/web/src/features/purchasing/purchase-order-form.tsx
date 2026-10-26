"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Line = {
  id: number;
  description: string;
  quantity: number;
  price: number;
};
const initialLines: Line[] = [
  { id: 1, description: "Tubo aço 50 × 50 mm", quantity: 54, price: 82.5 },
];
export function PurchaseOrderForm() {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.price,
    0,
  );

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function resetFormState() {
    setLines(initialLines);
    setDirty(false);
    setSaved(false);
  }
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/compras/pedidos"
        onClick={(event) => {
          if (dirty && !window.confirm("Descartar as alterações deste pedido?")) event.preventDefault();
        }}
      >
        <ArrowLeft className="size-4" />
        Pedidos de compra
      </Link>
      <header className="mt-6 border-b border-border pb-7">
        <p className="text-sm font-medium text-primary">Compras / Pedidos</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Novo pedido de compra
        </h1>
        <p className="mt-3 text-muted-foreground">
          Monte uma solicitação demonstrativa. Nada será enviado ao fornecedor.
        </p>
      </header>
      {saved && (
        <div
          className="mt-5 flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-5 text-emerald-500" />
          Pedido salvo apenas nesta sessão.
        </div>
      )}
      <form
        className="mt-6 space-y-6"
        onChange={markDirty}
        onSubmit={(e) => {
          e.preventDefault();
          setDirty(false);
          setSaved(true);
        }}
      >
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Fornecedor e entrega</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Fornecedor
              <select
                className="h-10 rounded-xl border border-input bg-background px-3"
                required
                defaultValue=""
              >
                <option value="">Selecione</option>
                <option>Aço Rio Preto</option>
                <option>Componentes Atlas</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Entrega prevista
              <Input type="date" required />
            </label>
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              Observações
              <Input placeholder="Instruções comerciais ou de recebimento" />
            </label>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Itens</h2>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLines((current) => [
                  ...current,
                  { id: Date.now(), description: "", quantity: 1, price: 0 },
                ]);
                markDirty();
              }}
            >
              <Plus />
              Adicionar
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div
                className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_100px_130px_auto] sm:items-end"
                key={line.id}
              >
                <label className="grid gap-2 text-sm">
                  Descrição
                  <Input
                    aria-label={`Descrição do item ${index + 1}`}
                    value={line.description}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? { ...item, description: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Quantidade
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? { ...item, quantity: Number(e.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Preço unitário
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.price}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? { ...item, price: Number(e.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Excluir item ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => {
                    setLines((current) =>
                      current.filter((item) => item.id !== line.id),
                    );
                    markDirty();
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end text-right">
            <div>
              <span className="text-sm text-muted-foreground">
                Total estimado
              </span>
              <strong className="block text-2xl">
                {total.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </strong>
            </div>
          </div>
        </section>
        <div className="sticky bottom-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background/95 p-3 backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground" role="status">{saved ? "Pedido salvo localmente" : dirty ? "Alterações não salvas" : "Nenhuma alteração pendente"}</span>
          <Button type="reset" variant="outline" onClick={resetFormState}>Cancelar</Button>
          <Button type="submit" disabled={!dirty}>
            <Save />
            Salvar demonstração
          </Button>
        </div>
      </form>
    </div>
  );
}
