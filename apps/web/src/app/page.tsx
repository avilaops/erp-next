const modules = [
  { name: "Cadastros", detail: "Produtos, pessoas e tabelas comerciais", phase: "Fase 2" },
  { name: "Vendas", detail: "Pedidos, propostas, PDV e faturamento", phase: "Fase 2" },
  { name: "Estoque", detail: "Movimentos, depósitos, compras e produção", phase: "Fase 2" },
  { name: "Financeiro", detail: "Obrigações, liquidações, caixa e conciliação", phase: "Fase 3" },
  { name: "Fiscal", detail: "NF-e, NFC-e, CT-e, NFS-e e monitor", phase: "Fase 3" },
  { name: "Logística", detail: "Expedição, etiquetas, postagem e reversa", phase: "Fase 4" },
  { name: "Serviços", detail: "Contratos, ordens, medições e cobranças", phase: "Fase 4" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex max-w-7xl flex-col gap-12 px-6 py-16 lg:px-10">
        <header className="grid gap-8 border-b border-white/10 pb-12 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-400">
              Ávila Ops · ERP Next
            </p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Operação integrada, com regras que não somem no meio do caminho.
            </h1>
          </div>
          <p className="max-w-xl text-base leading-7 text-slate-400 lg:justify-self-end">
            Fundação multiempresa com auditoria, permissões e eventos transacionais.
            O primeiro fluxo vertical será pedido de venda com reserva de estoque.
          </p>
        </header>

        <section aria-labelledby="foundation-title" className="grid gap-4 lg:grid-cols-4">
          <h2 id="foundation-title" className="sr-only">Fundação técnica</h2>
          {[
            ["Arquitetura", "Monólito modular"],
            ["Backend", "Rust + Axum"],
            ["Dados", "PostgreSQL + SQLx"],
            ["Interface", "Next.js + React"],
          ].map(([label, value]) => (
            <article key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-medium">{value}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="modules-title">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-cyan-400">Mapa do produto</p>
              <h2 id="modules-title" className="mt-1 text-2xl font-semibold">Domínios do ERP</h2>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
              Fase 1 em implantação
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((module) => (
              <article key={module.name} className="group rounded-2xl border border-white/10 bg-slate-900 p-6 transition hover:border-cyan-400/40">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-xl font-medium">{module.name}</h3>
                  <span className="text-xs text-slate-500">{module.phase}</span>
                </div>
                <p className="mt-8 text-sm leading-6 text-slate-400">{module.detail}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

