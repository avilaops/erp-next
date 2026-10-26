import Link from "next/link";
import { ArrowLeft, Barcode, Boxes, Pencil, ReceiptText } from "lucide-react";

const products: Record<
  string,
  {
    name: string;
    sku: string;
    gtin: string;
    ncm: string;
    category: string;
    price: string;
    stock: string;
  }
> = {
  "PRD-001": {
    name: "Leg press 45°",
    sku: "PRD-001",
    gtin: "7891000000012",
    ncm: "9506.91.00",
    category: "Musculação",
    price: "R$ 18.900,00",
    stock: "12 unidades",
  },
  "PRD-002": {
    name: "Crossover profissional",
    sku: "PRD-002",
    gtin: "Não informado",
    ncm: "9506.91.00",
    category: "Musculação",
    price: "R$ 12.480,00",
    stock: "8 unidades",
  },
};

export function ProductDetail({ productId }: { productId: string }) {
  const product = products[productId] ?? products["PRD-001"];
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 lg:px-6">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        href="/cadastros/produtos"
      >
        <ArrowLeft className="size-4" />
        Produtos
      </Link>
      <header className="mt-6 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">
            Cadastros / Produtos / {product.sku}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-3 text-muted-foreground">
            Detalhes demonstrativos do produto na empresa Ludus Equipamentos.
          </p>
        </div>
        <Link
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          href={`/cadastros/produtos/${productId}/editar`}
        >
          <Pencil className="size-4" />
          Editar produto
        </Link>
      </header>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Info
          icon={Barcode}
          label="SKU / GTIN"
          value={`${product.sku} · ${product.gtin}`}
        />
        <Info
          icon={ReceiptText}
          label="Classificação fiscal"
          value={`NCM ${product.ncm}`}
        />
        <Info icon={Boxes} label="Categoria" value={product.category} />
        <Info icon={Boxes} label="Estoque disponível" value={product.stock} />
        <Info icon={ReceiptText} label="Preço de venda" value={product.price} />
      </div>
      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Variantes</h2>
        <div className="mt-4 rounded-xl border border-border p-4">
          <strong className="text-sm">Padrão</strong>
          <p className="mt-1 text-sm text-muted-foreground">
            Unidade UN · produto ativo
          </p>
        </div>
      </section>
      <p className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        Dados locais demonstrativos. Estoque, preço e situação ainda não são
        consultados no backend.
      </p>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <Icon className="size-5 text-primary" />
      <span className="mt-4 block text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1 block text-sm">{value}</strong>
    </section>
  );
}
