"use client";

import { useState } from "react";
import { ArrowRight, Lightbulb, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailCard, Fact, PurchasingDetailShell } from "./details-shell";

const items = [
  { id: 1, name: "Rolamento 6204", quantity: 30, value: "R$ 1.260,00" },
  { id: 2, name: "Cabo de aço 6 mm", quantity: 120, value: "R$ 2.880,00" },
  { id: 3, name: "Estofado preto", quantity: 18, value: "R$ 3.420,00" },
];

export function PurchaseSuggestionDetail({ id }: { id: string }) {
  const [selected, setSelected] = useState(items.map((item) => item.id));
  const [converted, setConverted] = useState(false);
  return (
    <PurchasingDetailShell
      back="/compras/sugestoes"
      eyebrow="Compras / Sugestões"
      title={id.toUpperCase()}
      description="Revise necessidades simuladas e prepare um pedido local."
      actions={
        <Button
          disabled={!selected.length || converted}
          onClick={() => setConverted(true)}
        >
          <ShoppingCart />
          Converter em pedido
        </Button>
      }
    >
      {converted && (
        <p
          className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          Pedido rascunho PC-DEMO-001 preparado localmente com {selected.length}{" "}
          item(ns). Nenhum fornecedor foi acionado.
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <DetailCard title="Itens sugeridos">
          <div className="space-y-3">
            {items.map((item) => (
              <label
                className="grid cursor-pointer gap-3 rounded-xl border border-border p-4 sm:grid-cols-[auto_minmax(0,1fr)_100px_120px] sm:items-center"
                key={item.id}
              >
                <input
                  className="size-5 accent-primary"
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((entry) => entry !== item.id),
                    );
                    setConverted(false);
                  }}
                />
                <strong className="text-sm">{item.name}</strong>
                <span className="text-sm text-muted-foreground">
                  {item.quantity} un.
                </span>
                <strong className="text-sm sm:text-right">{item.value}</strong>
              </label>
            ))}
          </div>
        </DetailCard>
        <DetailCard title="Critério">
          <span className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Lightbulb className="size-5" />
          </span>
          <dl className="grid gap-4">
            <Fact label="Origem" value="Estoque mínimo + demanda" />
            <Fact label="Fornecedor sugerido" value="Componentes Atlas" />
            <Fact label="Valor estimado" value="R$ 7.560,00" />
            <Fact label="Prioridade" value="Reposição em 7 dias" />
          </dl>
        </DetailCard>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        <ArrowRight className="size-4 shrink-0 text-primary" />A conversão cria
        somente uma prévia visual; preços, impostos e disponibilidade exigirão
        validação posterior.
      </div>
    </PurchasingDetailShell>
  );
}
