"use client";
import { PageTitle } from "@/components/workspace/page-title"

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { erpFetch } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/error-message";

type ServiceOrder = {
  id: string;
  protocol: string;
  title: string;
  status: "open" | "scheduled" | "in_repair" | "awaiting_parts" | "completed" | "cancelled";
  laborCents: number;
  updatedAt?: string;
};

const statusLabel: Record<ServiceOrder["status"], string> = {
  open: "Aberta",
  scheduled: "Agendada",
  in_repair: "Em reparo",
  awaiting_parts: "Aguardando peça",
  completed: "Concluída",
  cancelled: "Cancelada",
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function ServiceReportsLive() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    erpFetch("/api/erp/warranty-service-orders?limit=100&offset=0", { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.title || "Relatório de serviços indisponível");
        setOrders(Array.isArray(value.data) ? value.data : []);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Relatório de serviços indisponível"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  const metrics = useMemo(() => {
    const active = orders.filter((order) => order.status !== "cancelled");
    const labor = active.reduce((total, order) => total + order.laborCents, 0);
    const completed = active.filter((order) => order.status === "completed").length;
    const awaitingParts = active.filter((order) => order.status === "awaiting_parts").length;
    return { active: active.length, labor, completed, awaitingParts };
  }, [orders]);

  function exportCsv() {
    const header = ["Protocolo", "Ordem", "Situação", "Mão de obra", "Atualização"];
    const body = orders.map((order) => [
      order.protocol,
      order.title,
      statusLabel[order.status],
      money(order.laborCents),
      order.updatedAt || "",
    ]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "relatorio-ordens-de-servico.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-8 lg:px-6">
      <Link className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href="/servicos">
        <ArrowLeft className="size-4" /> Voltar
      </Link>
      <header className="flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Serviços</p>
          <PageTitle className="mt-2 text-3xl font-semibold tracking-tight">Relatórios de serviços</PageTitle>
          <p className="mt-3 max-w-3xl text-muted-foreground">Indicadores calculados a partir das ordens persistidas da empresa ativa.</p>
        </div>
        <Button disabled={loading || !orders.length} variant="outline" onClick={exportCsv}><Download />Exportar CSV</Button>
      </header>

      {loading ? <p className="mt-6" role="status">Carregando ordens de serviço…</p> : error ? (
        <section className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-6" role="alert">
          <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0" /><div><h2 className="font-semibold">Não foi possível carregar o relatório</h2><p className="mt-1 text-sm text-muted-foreground">{error}</p><Button className="mt-4" variant="outline" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}><RefreshCw />Tentar novamente</Button></div></div>
        </section>
      ) : !orders.length ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6"><h2 className="font-semibold">Nenhuma ordem de serviço encontrada</h2><p className="mt-1 text-sm text-muted-foreground">O relatório será preenchido quando houver ordens persistidas na empresa ativa.</p></section>
      ) : <>
        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[["Ordens ativas", String(metrics.active)], ["Concluídas", String(metrics.completed)], ["Aguardando peça", String(metrics.awaitingParts)], ["Mão de obra", money(metrics.labor)]].map(([label, value]) => <div className="rounded-2xl border border-border bg-card p-5" key={label}><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>)}
        </section>
        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-4"><h2 className="font-semibold">Ordens incluídas</h2><p className="mt-1 text-sm text-muted-foreground">Até 100 registros mais recentes retornados pela API.</p></div>
          <div className="divide-y divide-border">{orders.map((order) => <article className="grid gap-2 p-4 sm:grid-cols-[150px_minmax(0,1fr)_170px] sm:items-center" key={order.id}><strong className="text-sm text-primary">{order.protocol}</strong><div><h3 className="text-sm font-medium">{order.title}</h3><p className="text-sm text-muted-foreground">{money(order.laborCents)}</p></div><span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs">{statusLabel[order.status]}</span></article>)}</div>
        </section>
      </>}
    </div>
  );
}
