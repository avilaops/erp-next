"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailCard, Fact, PurchasingDetailShell } from "./details-shell";

const initialItems = [
  {
    id: 1,
    name: "Tubo aço 50 × 50 mm",
    expected: 54,
    received: 54,
    checked: false,
  },
  { id: 2, name: "Chapa aço 3 mm", expected: 12, received: 10, checked: false },
];

export function ReceiptCheckIn({ id }: { id: string }) {
  const [items, setItems] = useState(initialItems);
  const [notes, setNotes] = useState("");
  const [finished, setFinished] = useState(false);
  const allChecked = items.every((item) => item.checked);
  const divergence = items.some((item) => item.expected !== item.received);
  const checked = useMemo(
    () => items.filter((item) => item.checked).length,
    [items],
  );
  return (
    <PurchasingDetailShell
      back="/compras/recebimentos"
      eyebrow="Compras / Recebimentos"
      title={id.toUpperCase()}
      description="Check-in físico com conferência e registro local de divergências."
      actions={
        <Button
          disabled={!allChecked || finished}
          onClick={() => setFinished(true)}
        >
          <CheckCircle2 />
          Finalizar conferência
        </Button>
      }
    >
      {finished && (
        <p
          className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          Conferência finalizada apenas nesta sessão. Nenhum saldo foi
          movimentado.
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <DetailCard title={`Itens conferidos · ${checked}/${items.length}`}>
          <div className="space-y-3">
            {items.map((item) => (
              <label
                className="grid cursor-pointer gap-3 rounded-xl border border-border p-4 sm:grid-cols-[auto_minmax(0,1fr)_120px_120px] sm:items-center"
                key={item.id}
              >
                <input
                  className="size-5 accent-primary"
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) => {
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, checked: event.target.checked }
                          : entry,
                      ),
                    );
                    setFinished(false);
                  }}
                />
                <strong className="text-sm">{item.name}</strong>
                <span className="text-sm text-muted-foreground">
                  Esperado: {item.expected}
                </span>
                <span
                  className={`text-sm font-medium ${item.received !== item.expected ? "text-amber-700 dark:text-amber-300" : ""}`}
                >
                  Recebido: {item.received}
                </span>
              </label>
            ))}
          </div>
        </DetailCard>
        <DetailCard title="Resumo">
          <dl className="grid gap-4">
            <Fact label="Fornecedor" value="Componentes Atlas" />
            <Fact label="Doca" value="02" />
            <Fact label="Volumes" value="36" />
            <Fact
              label="Situação"
              value={finished ? "Finalizado localmente" : "Em conferência"}
            />
          </dl>
        </DetailCard>
      </div>
      {divergence && (
        <DetailCard className="mt-5" title="Divergência">
          <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
            Foram recebidas 2 unidades a menos de Chapa aço 3 mm.
          </div>
          <label className="mt-4 grid gap-2 text-sm font-medium">
            Tratativa
            <textarea
              className="min-h-28 rounded-lg border border-input bg-background p-3 text-sm"
              placeholder="Descreva a ressalva, devolução ou contato com o fornecedor"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setFinished(false);
              }}
            />
          </label>
        </DetailCard>
      )}
      <p className="mt-5 flex gap-2 text-xs text-muted-foreground">
        <ClipboardCheck className="size-4" />A conferência não atualiza estoque
        nem contas a pagar sem backend.
      </p>
    </PurchasingDetailShell>
  );
}
