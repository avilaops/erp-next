"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";

export function ProductForm({
  mode = "create",
  productId,
}: {
  mode?: "create" | "edit";
  productId?: string;
}) {
  const editing = mode === "edit";
  const [variants, setVariants] = useState(["Padrão"]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function resetFormState() {
    setVariants(["Padrão"]);
    setDirty(false);
    setSaved(false);
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDirty(false);
    setSaved(true);
  }
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/cadastros/produtos"
      >
        <ArrowLeft className="size-4" />
        Produtos
      </Link>
      <PageHeader
        eyebrow="Cadastros / Produtos"
        title={editing ? "Editar produto" : "Novo produto"}
        description={
          editing
            ? `Atualize o produto ${productId ?? "selecionado"}. As alterações permanecem locais.`
            : "Cadastre identidade comercial, classificação fiscal, variantes, imagens e preço demonstrativo."
        }
      />
      <form
        className="space-y-6"
        onChange={() => {
          setDirty(true);
          setSaved(false);
        }}
        onSubmit={submit}
      >
        <div className="sticky top-20 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span
            className="mr-auto basis-full text-sm text-muted-foreground sm:basis-auto"
            role="status"
          >
            {saved
              ? "Produto salvo localmente"
              : dirty
                ? "Alterações não salvas"
                : "Nenhuma alteração pendente"}
          </span>
          <Button type="reset" variant="outline" onClick={resetFormState}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!dirty}>
            <Save />
            Salvar produto
          </Button>
        </div>
        {saved && (
          <p className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            Salvo somente nesta demonstração; nenhum dado foi enviado.
          </p>
        )}
        <Section title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do produto *">
              <Input
                defaultValue={editing ? "Leg press 45°" : ""}
                required
                placeholder="Ex.: Leg press 45°"
              />
            </Field>
            <Field label="SKU *">
              <Input
                defaultValue={editing ? "PRD-001" : ""}
                required
                placeholder="PRD-000"
              />
            </Field>
            <Field label="GTIN">
              <Input
                defaultValue={editing ? "7891000000012" : ""}
                inputMode="numeric"
                placeholder="Código de barras"
              />
            </Field>
            <Field label="Categoria">
              <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                <option>Musculação</option>
                <option>Bancos e suportes</option>
                <option>Sem classificação</option>
              </select>
            </Field>
            <Field className="sm:col-span-2" label="Descrição">
              <textarea
                className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm"
                placeholder="Características comerciais"
              />
            </Field>
          </div>
        </Section>
        <Section title="Fiscal e preço">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="NCM">
              <Input
                defaultValue={editing ? "9506.91.00" : ""}
                placeholder="0000.00.00"
              />
            </Field>
            <Field label="Unidade">
              <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                <option>UN</option>
                <option>KG</option>
                <option>CX</option>
              </select>
            </Field>
            <Field label="Preço de venda">
              <Input
                defaultValue={editing ? "18900,00" : ""}
                inputMode="decimal"
                placeholder="R$ 0,00"
              />
            </Field>
          </div>
        </Section>
        <Section title="Variantes">
          <div className="space-y-3">
            {variants.map((variant, index) => (
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
                key={`${variant}-${index}`}
              >
                <Input
                  className="min-w-0 flex-1"
                  aria-label={`Nome da variante ${index + 1}`}
                  value={variant}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Excluir variante ${index + 1}`}
                  disabled={variants.length === 1}
                  onClick={() => {
                    setVariants((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    );
                    setDirty(true);
                    setSaved(false);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <Button
            className="mt-3"
            type="button"
            variant="outline"
            onClick={() => {
              setVariants((current) => [
                ...current,
                `Variante ${current.length + 1}`,
              ]);
              setDirty(true);
            }}
          >
            <Plus />
            Adicionar variante
          </Button>
        </Section>
        <Section title="Imagem">
          <button
            className="flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-5 text-sm text-muted-foreground"
            type="button"
            onClick={() => setDirty(true)}
          >
            <ImagePlus className="mb-2 size-6" />
            Selecionar imagem local
            <div className="mt-1 text-xs">
              Apenas demonstração; nenhum arquivo será enviado.
            </div>
          </button>
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
