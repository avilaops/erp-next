"use client";
import { PageTitle } from "@/components/workspace/page-title"

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCheck2,
  PackageCheck,
  Printer,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { erpFetch } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/error-message";

function Shell({ back, eyebrow, title, description, actions, demo = true, children }: { back: string; eyebrow: string; title: string; description: string; actions?: React.ReactNode; demo?: boolean; children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" />Voltar</Link>
    <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-medium text-primary">{eyebrow}</p><PageTitle className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</PageTitle><p className="mt-3 max-w-3xl text-muted-foreground">{description}</p></div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    {demo && <div className="mt-6 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">Demonstração local. Nenhuma postagem, etiqueta, coleta, cotação ou contratação é transmitida.</div>}
    {children}
  </main>;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-5 sm:p-6 ${className}`}><h2 className="mb-5 font-semibold">{title}</h2>{children}</section>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>;
}

type Posting = {
  id: string;
  code: string;
  recipientName: string;
  service: string;
  destinationCity: string;
  destinationState: string;
  packageCount: number;
  weightGrams: number;
  declaredValueCents: number;
  trackingCode: string | null;
  carrier: string | null;
  revision: number;
  status: "prepared" | "posted" | "in_transit" | "delivered" | "cancelled";
};

export function PostingForm() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const command = useRef<{ key: string; body: string } | null>(null);
  useEffect(() => { const controller = new AbortController(); erpFetch("/api/erp/logistics/postings?limit=1", { signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.title || "Postagens indisponíveis"); setTenantId(value.tenantId); }).catch(cause => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Postagens indisponíveis")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  return <Shell back="/logistica/postagens" eyebrow="Logística / Postagens" title="Nova postagem" description="Prepare volumes, serviço e destinatário antes da expedição." demo={false}>
    <form className="mt-6 grid gap-5" onSubmit={async (event) => { event.preventDefault(); if (saving || !tenantId) return; const form = new FormData(event.currentTarget); const body = JSON.stringify({ recipientName: String(form.get("recipientName")), service: String(form.get("service")), destinationCity: String(form.get("destinationCity")), destinationState: String(form.get("destinationState")), packageCount: Number(form.get("packageCount")), weightGrams: Math.round(Number(form.get("weightKg")) * 1000), declaredValueCents: Math.round(Number(form.get("declaredValue")) * 100), orderId: String(form.get("orderId") || "").trim() || null, carrier: String(form.get("carrier") || "").trim() || null, trackingCode: String(form.get("trackingCode") || "").trim() || null }); const current = command.current || { key: crypto.randomUUID(), body }; if (!command.current) command.current = current; setSaving(true); setError(""); try { const response = await erpFetch("/api/erp/logistics/postings", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": current.key }, body: current.body }); const value = await response.json(); if (!response.ok) { if (response.status >= 500) setUncertain(true); throw new Error(value.title || "Não foi possível criar a postagem"); } if (!value.data?.id) throw new Error("Confirmação incompleta"); setUncertain(false); command.current = null; router.replace(`/logistica/postagens/${value.data.id}`); } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível confirmar a postagem")); } finally { setSaving(false); } }}>
      <Card title="Dados da postagem"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Pedido (UUID, opcional)"><Input name="orderId" /></FormField><FormField label="Destinatário"><Input name="recipientName" required /></FormField><FormField label="Serviço"><Input name="service" defaultValue="expresso" required /></FormField><FormField label="Transportadora"><Input name="carrier" /></FormField><FormField label="Rastreio"><Input name="trackingCode" /></FormField><FormField label="Cidade de destino"><Input name="destinationCity" required /></FormField><FormField label="UF de destino"><Input name="destinationState" maxLength={2} required /></FormField><FormField label="Volumes"><Input name="packageCount" min="1" type="number" required /></FormField><FormField label="Peso total (kg)"><Input name="weightKg" min="0.001" step="0.001" type="number" required /></FormField><FormField label="Valor declarado (R$)"><Input name="declaredValue" min="0" step="0.01" type="number" required /></FormField></div></Card>
      {loading && <p role="status">Carregando empresa ativa…</p>}{error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">{error}{uncertain && " A confirmação pode ter sido processada; repita para consultar sem duplicar."}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button nativeButton={false} render={<Link href="/logistica/postagens" />} variant="outline">Cancelar</Button><Button disabled={saving || loading || !tenantId} type="submit"><Save />{saving ? "Salvando…" : uncertain ? "Conferir postagem" : "Criar postagem"}</Button></div>
    </form>
  </Shell>;
}

export function PostingDetail({ id }: { id: string }) {
  const [posting, setPosting] = useState<Posting | null>(null); const [tenantId, setTenantId] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [checkoutId, setCheckoutId] = useState(""); const [linking, setLinking] = useState(false);
  const load = useCallback(() => { const controller = new AbortController(); erpFetch(`/api/erp/logistics/postings/${id}`, { signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.title || "Postagem indisponível"); setPosting(value.data); setTenantId(value.tenantId); setError(""); }).catch(cause => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Postagem indisponível")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const nextStatus = { prepared: ["posted", "Registrar postagem", <Send key="post" />], posted: ["in_transit", "Iniciar trânsito", <Truck key="transit" />], in_transit: ["delivered", "Confirmar entrega", <PackageCheck key="deliver" />] } as const;
  async function changeStatus() { if (saving || !posting || !tenantId) return; const next = nextStatus[posting.status as keyof typeof nextStatus]; if (!next) return; setSaving(true); setError(""); try { const response = await erpFetch(`/api/erp/logistics/postings/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": crypto.randomUUID(), "If-Match": `"${posting.revision}"` }, body: JSON.stringify({ status: next[0] }) }); const value = await response.json(); if (!response.ok) throw new Error(value.title || "Não foi possível atualizar a situação"); setPosting((current) => current ? { ...current, status: value.data.status, revision: value.data.revision } : current); } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível atualizar a situação")); } finally { setSaving(false); } }
  async function linkPackages(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!posting || linking || !tenantId || !checkoutId.trim()) return; setLinking(true); setError(""); try { const response = await erpFetch(`/api/erp/logistics/postings/${id}/packages`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ checkoutId: checkoutId.trim() }) }); const value = await response.json(); if (!response.ok) throw new Error(value.title || "Não foi possível vincular os volumes"); setError(`${value.data.packageIds.length} volume(s) vinculado(s) à postagem.`); } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível vincular os volumes")); } finally { setLinking(false); } }
  return <Shell back="/logistica/postagens" eyebrow="Logística / Postagens" title={posting?.code || "Postagem"} description="Detalhes e situação operacional da postagem." demo={false} actions={<Button disabled={saving || !posting || !(posting.status in nextStatus)} onClick={changeStatus}>{posting ? nextStatus[posting.status as keyof typeof nextStatus]?.[2] : <PackageCheck />}{posting ? nextStatus[posting.status as keyof typeof nextStatus]?.[1] : "Atualizar situação"}</Button>}>
    {loading ? <p className="mt-6" role="status">Carregando postagem…</p> : error ? <div className="mt-6 space-y-3"><p role="alert">{error}</p><Button variant="outline" onClick={load}>Tentar novamente</Button></div> : posting && <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card title="Dados da postagem"><dl className="grid gap-4 sm:grid-cols-2"><Field label="Destinatário" value={posting.recipientName} /><Field label="Serviço" value={posting.service} /><Field label="Transportadora" value={posting.carrier || "Não informada"} /><Field label="Destino" value={`${posting.destinationCity} / ${posting.destinationState}`} /><Field label="Volumes" value={String(posting.packageCount)} /><Field label="Peso" value={`${(posting.weightGrams / 1000).toLocaleString("pt-BR")} kg`} /><Field label="Valor declarado" value={(posting.declaredValueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} /></dl></Card><Card title="Situação"><strong className="text-lg">{{ prepared: "Preparado", posted: "Postado", in_transit: "Em trânsito", delivered: "Entregue", cancelled: "Cancelado" }[posting.status]}</strong><p className="mt-2 text-sm text-muted-foreground">{posting.trackingCode || "Sem código de rastreio"}</p><p className="mt-3 text-xs text-muted-foreground">Revisão {posting.revision}</p></Card><Card className="lg:col-span-2" title="Vincular volumes embalados"><form className="flex flex-wrap items-end gap-3" onSubmit={linkPackages}><FormField label="UUID do checkout"><Input required value={checkoutId} onChange={(event) => setCheckoutId(event.target.value)} /></FormField><Button disabled={linking}>{linking ? "Vinculando…" : "Vincular volumes"}</Button></form><p className="mt-3 text-xs text-muted-foreground">Somente volumes com status embalado serão vinculados. A postagem não é enviada à transportadora por esta ação.</p></Card></div>}
  </Shell>;
}

export function ReturnForm() {
  const [notice, setNotice] = useState("");
  return <Shell back="/logistica/reversa" eyebrow="Logística / Reversa" title="Nova autorização" description="Registre a solicitação, motivo e forma de coleta da devolução.">
    <form className="mt-6 grid gap-5" onSubmit={(event) => { event.preventDefault(); setNotice("Autorização REV-092 criada somente nesta demonstração."); }}><Card title="Solicitação"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Cliente"><Input defaultValue="Academia Horizonte" required /></FormField><FormField label="Pedido"><Input defaultValue="PV-1048" required /></FormField><FormField label="Motivo"><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option>Garantia</option><option>Arrependimento</option><option>Avaria no transporte</option></select></FormField><FormField label="Coleta"><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option>No endereço do cliente</option><option>Postagem pelo cliente</option></select></FormField><FormField label="Descrição"><Textarea className="sm:col-span-2" defaultValue="Cabo de crossover com desgaste prematuro." /></FormField></div></Card><div className="flex justify-end"><Button type="submit"><RotateCcw />Gerar autorização local</Button></div>{notice && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">{notice}</p>}</form>
  </Shell>;
}

export function ReturnDetail({ id }: { id: string }) {
  const [stage, setStage] = useState(1);
  const stages = ["Autorizada", "Em trânsito", "Recebida", "Em análise"];
  return <Shell back="/logistica/reversa" eyebrow="Logística / Reversa" title={id.toUpperCase()} description="Acompanhamento demonstrativo da devolução e sua relação com a garantia." actions={<Button disabled={stage === stages.length - 1} onClick={() => setStage((value) => Math.min(value + 1, stages.length - 1))}><CheckCircle2 />Avançar etapa</Button>}><div className="mt-6 grid gap-5 lg:grid-cols-2"><Card title="Etapas"><ol className="space-y-3">{stages.map((item, index) => <li className={`flex items-center gap-3 rounded-xl border p-3 ${index <= stage ? "border-primary/30 bg-primary/5" : "border-border"}`} key={item}>{index < stage ? <CheckCircle2 className="size-5 text-primary" /> : <CircleDot className="size-5 text-muted-foreground" />}<span className="text-sm font-medium">{item}</span></li>)}</ol></Card><Card title="Vínculos"><dl className="grid gap-4"><Field label="Cliente" value="Box Alpha" /><Field label="Pedido" value="PV-1048" /><Field label="Garantia" value="GAR-087" /><Field label="Situação" value={stages[stage]} /></dl></Card></div><p className="mt-5 text-sm text-muted-foreground" role="status">Etapa atualizada apenas localmente.</p></Shell>;
}

export function CheckoutDetail({ id }: { id: string }) {
  type CheckoutLine = { lineNumber: number; sku: string; name: string; expectedQuantityMicros: number; checkedQuantityMicros: number };
  type CheckoutPackage = { id: string; packageNumber: number; weightGrams: number; lengthMm: number; widthMm: number; heightMm: number; labelCode: string | null; status: "prepared" | "labelled" | "packed" };
  type Checkout = { id: string; orderId: string; status: "counting" | "completed" | "cancelled"; revision: number; lines: CheckoutLine[]; packages: CheckoutPackage[] };
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingLine, setSavingLine] = useState<number | null>(null);
  const [savingPackage, setSavingPackage] = useState(false);
  const [savingPackageId, setSavingPackageId] = useState<string | null>(null);
  const [queueingLabels, setQueueingLabels] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    const controller = new AbortController();
    erpFetch(`/api/erp/logistics/checkouts/${id}`, { signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Checkout indisponível");
      setCheckout(value.data);
      setTenantId(value.tenantId);
      setError("");
    }).catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Checkout indisponível")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const checked = checkout?.lines.filter((line) => line.checkedQuantityMicros >= line.expectedQuantityMicros).length ?? 0;
  const canComplete = Boolean(checkout && checkout.status === "counting" && checkout.lines.length > 0 && checked === checkout.lines.length);
  async function checkLine(line: CheckoutLine, checkedQuantityMicros: number) {
    if (!checkout || savingLine !== null || checkout.status !== "counting") return;
    setSavingLine(line.lineNumber); setError("");
    try {
      const response = await erpFetch(`/api/erp/logistics/checkouts/${id}/lines/${line.lineNumber}/check`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `\"${checkout.revision}\"`, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ checkedQuantityMicros }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível conferir o item");
      setCheckout((current) => current ? { ...current, revision: value.data.revision, lines: current.lines.map((item) => item.lineNumber === line.lineNumber ? { ...item, checkedQuantityMicros: value.data.checkedQuantityMicros } : item) } : current);
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível conferir o item")); } finally { setSavingLine(null); }
  }
  async function complete() {
    if (!checkout || completing || !canComplete) return;
    setCompleting(true); setError("");
    try {
      const response = await erpFetch(`/api/erp/logistics/checkouts/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `\"${checkout.revision}\"`, "Idempotency-Key": crypto.randomUUID() }, body: "{}" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível concluir o checkout");
      setCheckout((current) => current ? { ...current, status: "completed", revision: value.data.revision } : current);
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível concluir o checkout")); } finally { setCompleting(false); }
  }
  async function addPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checkout || savingPackage || checkout.status !== "counting") return;
    const form = new FormData(event.currentTarget);
    setSavingPackage(true); setError("");
    try {
      const response = await erpFetch(`/api/erp/logistics/checkouts/${id}/packages`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `\"${checkout.revision}\"`, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ weightGrams: Math.round(Number(form.get("weightGrams"))), lengthMm: Math.round(Number(form.get("lengthMm"))), widthMm: Math.round(Number(form.get("widthMm"))), heightMm: Math.round(Number(form.get("heightMm"))), labelCode: String(form.get("labelCode") || "").trim() || null }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível adicionar o volume");
      setCheckout((current) => current ? { ...current, revision: value.data.revision, packages: [...current.packages, value.data] } : current);
      event.currentTarget.reset();
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível adicionar o volume")); } finally { setSavingPackage(false); }
  }
  async function changePackageStatus(item: CheckoutPackage) {
    const nextStatus = item.status === "prepared" ? "labelled" : item.status === "labelled" ? "packed" : null;
    if (!checkout || !nextStatus || savingPackageId || checkout.status !== "counting") return;
    setSavingPackageId(item.id); setError("");
    try {
      const response = await erpFetch(`/api/erp/logistics/checkouts/${id}/packages/${item.id}/status`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `\"${checkout.revision}\"`, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ status: nextStatus }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível atualizar o volume");
      setCheckout((current) => current ? { ...current, revision: value.data.revision, packages: current.packages.map((packageItem) => packageItem.id === item.id ? { ...packageItem, status: value.data.status } : packageItem) } : current);
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível atualizar o volume")); } finally { setSavingPackageId(null); }
  }
  async function queueLabels() {
    if (!checkout || queueingLabels || checkout.packages.every((item) => item.status !== "labelled")) return;
    setQueueingLabels(true); setError("");
    try {
      const response = await erpFetch(`/api/erp/logistics/checkouts/${id}/labels`, { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "Idempotency-Key": crypto.randomUUID() }, body: "{}" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.title || "Não foi possível gerar a fila de etiquetas");
      setError(`Fila de etiquetas criada para ${value.data.jobIds.length} volume(s).`);
    } catch (cause) { setError(apiErrorMessage(cause, "Não foi possível gerar a fila de etiquetas")); } finally { setQueueingLabels(false); }
  }
  return <Shell back="/logistica/checkout" eyebrow="Logística / Checkout" title={checkout ? `Pedido ${checkout.orderId}` : "Checkout"} description="Conferência item a item antes da expedição." demo={false} actions={<><Button disabled={queueingLabels || !checkout?.packages.some((item) => item.status === "labelled")} onClick={queueLabels}><Printer />{queueingLabels ? "Gerando…" : "Gerar etiquetas"}</Button><Button disabled={!canComplete || completing} onClick={complete}><ShieldCheck />{completing ? "Concluindo…" : "Concluir conferência"}</Button></>}>
    {loading ? <p className="mt-6" role="status">Carregando checkout…</p> : error && !checkout ? <div className="mt-6 space-y-3"><p role="alert">{error}</p><Button variant="outline" onClick={load}>Tentar novamente</Button></div> : checkout && <><Card className="mt-6" title={`Itens conferidos · ${checked}/${checkout.lines.length}`}><div className="space-y-3">{checkout.lines.map((line) => { const completeLine = line.checkedQuantityMicros >= line.expectedQuantityMicros; return <label className={`flex items-center gap-3 rounded-xl border border-border p-4 ${checkout.status === "counting" ? "cursor-pointer" : ""}`} key={line.lineNumber}><input aria-label={`Conferir ${line.name}`} className="size-5 accent-primary" checked={completeLine} disabled={checkout.status !== "counting" || savingLine !== null} onChange={(event) => void checkLine(line, event.target.checked ? line.expectedQuantityMicros : 0)} type="checkbox" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{line.name}</span><span className="text-xs text-muted-foreground">{line.sku}</span></span><span className="text-sm text-muted-foreground">{line.checkedQuantityMicros / 1_000_000} / {line.expectedQuantityMicros / 1_000_000} un.</span></label>; })}</div></Card><Card className="mt-5" title={`Volumes · ${checkout.packages.length}`}><form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={addPackage}><FormField label="Peso (g)"><Input min="1" name="weightGrams" required type="number" /></FormField><FormField label="Comprimento (mm)"><Input min="1" name="lengthMm" required type="number" /></FormField><FormField label="Largura (mm)"><Input min="1" name="widthMm" required type="number" /></FormField><FormField label="Altura (mm)"><Input min="1" name="heightMm" required type="number" /></FormField><FormField label="Código da etiqueta"><Input name="labelCode" /></FormField><Button className="sm:col-span-2 lg:col-span-5 lg:w-fit" disabled={savingPackage || checkout.status !== "counting"} type="submit"><PackageCheck />{savingPackage ? "Adicionando…" : "Adicionar volume"}</Button></form>{checkout.packages.length > 0 && <div className="mt-5 divide-y divide-border rounded-xl border border-border">{checkout.packages.map((item) => <div className="grid gap-2 p-3 text-sm sm:grid-cols-[80px_1fr_1fr]" key={item.id}><strong>Vol. {item.packageNumber}</strong><span>{item.weightGrams} g · {item.lengthMm} × {item.widthMm} × {item.heightMm} mm</span><span className="text-muted-foreground">{item.labelCode || "Sem etiqueta"} · {item.status}</span><Button className="sm:col-span-3 sm:w-fit" disabled={savingPackageId !== null || checkout.status !== "counting" || item.status === "packed"} onClick={() => void changePackageStatus(item)} variant="outline">{savingPackageId === item.id ? "Atualizando…" : item.status === "prepared" ? "Marcar etiquetado" : item.status === "labelled" ? "Marcar embalado" : "Embalado"}</Button></div>)}</div>}</Card>{error && <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">{error}</p>}{checkout.status === "completed" && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">Checkout concluído. A baixa de estoque e a geração da postagem permanecem separadas deste fluxo.</p>}</>}
  </Shell>;
}

export function LabelForm() {
  const [queued, setQueued] = useState(false);
  return <Shell back="/logistica/etiquetas" eyebrow="Logística / Etiquetas" title="Preparar etiquetas" description="Configure o documento e a impressora antes de incluir a tarefa na fila."><form className="mt-6" onSubmit={(event) => { event.preventDefault(); setQueued(true); }}><Card title="Impressão"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Origem"><Input defaultValue="PV-1048" required /></FormField><FormField label="Tipo"><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option>Transporte</option><option>Volumes</option><option>Logística reversa</option></select></FormField><FormField label="Impressora"><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option>Expedição 01</option><option>Expedição 02</option></select></FormField><FormField label="Cópias"><Input min="1" defaultValue="2" type="number" /></FormField></div><Button className="mt-5" type="submit"><Printer />Adicionar à fila local</Button></Card>{queued && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">Tarefa FILA-332 adicionada à fila demonstrativa. Nada foi impresso.</p>}</form></Shell>;
}

export function LabelDetail({ id }: { id: string }) {
  const [state, setState] = useState("Na fila");
  return <Shell back="/logistica/etiquetas" eyebrow="Logística / Etiquetas" title={id.toUpperCase()} description="Estado e preparação da tarefa de impressão." actions={<Button disabled={state === "Concluída localmente"} onClick={() => setState("Concluída localmente")}><Printer />Simular impressão</Button>}><div className="mt-6 grid gap-5 sm:grid-cols-2"><Card title="Documento"><dl className="grid gap-4"><Field label="Origem" value="PV-1048" /><Field label="Tipo" value="Etiqueta de transporte" /><Field label="Cópias" value="2" /></dl></Card><Card title="Fila"><dl className="grid gap-4"><Field label="Impressora" value="Expedição 01" /><Field label="Criada em" value="25/10/2026 14:20" /><Field label="Situação" value={state} /></dl></Card></div><p className="mt-5 text-sm text-muted-foreground" role="status">{state === "Na fila" ? "Aguardando simulação." : "Impressão registrada somente nesta sessão."}</p></Shell>;
}

export function ShippingForm() {
  const [quoted, setQuoted] = useState(false);
  return <Shell back="/logistica/envios" eyebrow="Logística / Ávila Envios" title="Simular cotação" description="Compare opções demonstrativas de prazo e preço sem consultar transportadoras."><form className="mt-6" onSubmit={(event) => { event.preventDefault(); setQuoted(true); }}><Card title="Origem, destino e carga"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Origem"><Input defaultValue="Votuporanga - SP" required /></FormField><FormField label="Destino"><Input defaultValue="Belo Horizonte - MG" required /></FormField><FormField label="Peso (kg)"><Input defaultValue="120" min="0.1" type="number" required /></FormField><FormField label="Volumes"><Input defaultValue="4" min="1" type="number" required /></FormField></div><Button className="mt-5" type="submit"><Truck />Calcular opções locais</Button></Card></form>{quoted && <div className="mt-5 grid gap-3 sm:grid-cols-3">{[["Transportadora A", "3 dias", "R$ 284,90"], ["Transportadora B", "5 dias", "R$ 241,30"], ["Transportadora C", "2 dias", "R$ 356,80"]].map(([name, time, price]) => <Card title={name} key={name}><p className="text-sm text-muted-foreground">{time}</p><strong className="mt-2 block text-xl">{price}</strong><Button className="mt-4" nativeButton={false} render={<Link href="/logistica/envios/COT-1842" />}>Ver e contratar</Button></Card>)}</div>}</Shell>;
}

export function ShippingDetail({ id }: { id: string }) {
  const [contracted, setContracted] = useState(false);
  const [tracking, setTracking] = useState(false);
  return <Shell back="/logistica/envios" eyebrow="Logística / Ávila Envios" title={id.toUpperCase()} description="Cotação, contratação e acompanhamento inteiramente demonstrativos." actions={<Button disabled={contracted} onClick={() => setContracted(true)}><Send />Contratar localmente</Button>}><div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card title="Frete selecionado"><dl className="grid gap-4 sm:grid-cols-2"><Field label="Transportadora" value="Transportadora A" /><Field label="Serviço" value="Expresso rodoviário" /><Field label="Prazo" value="3 dias úteis" /><Field label="Preço" value="R$ 284,90" /><Field label="Origem" value="Votuporanga - SP" /><Field label="Destino" value="Belo Horizonte - MG" /></dl></Card><Card title="Situação"><Truck className="size-6 text-primary" /><strong className="mt-4 block">{contracted ? (tracking ? "Em trânsito local" : "Contratado localmente") : "Cotação aberta"}</strong><p className="mt-2 text-sm text-muted-foreground">Nenhuma transportadora foi acionada.</p>{contracted && !tracking && <Button className="mt-4" variant="outline" onClick={() => setTracking(true)}><Clock3 />Iniciar acompanhamento</Button>}</Card></div>{contracted && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status"><FileCheck2 className="mr-2 inline size-4" />Contratação registrada apenas nesta demonstração.</p>}</Shell>;
}
