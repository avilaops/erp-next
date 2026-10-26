"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

function Shell({ back, eyebrow, title, description, actions, children }: { back: string; eyebrow: string; title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" />Voltar</Link>
    <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-medium text-primary">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{description}</p></div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    <div className="mt-6 rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">Demonstração local. Nenhuma postagem, etiqueta, coleta, cotação ou contratação é transmitida.</div>
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

export function PostingForm() {
  const [notice, setNotice] = useState("");
  return <Shell back="/logistica/postagens" eyebrow="Logística / Postagens" title="Nova postagem" description="Prepare volumes, serviço e destinatário antes da expedição.">
    <form className="mt-6 grid gap-5" onSubmit={(event) => { event.preventDefault(); setNotice("Postagem demonstrativa OBJ-2482 preparada localmente."); }}>
      <Card title="Dados da postagem"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Pedido"><Input defaultValue="PV-1049" required /></FormField><FormField label="Destinatário"><Input defaultValue="Academia Sparta" required /></FormField><FormField label="Serviço"><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue="expresso"><option value="expresso">Expresso</option><option value="economico">Econômico</option></select></FormField><FormField label="Volumes"><Input min="1" defaultValue="2" type="number" required /></FormField><FormField label="Peso total (kg)"><Input min="0.1" step="0.1" defaultValue="38.5" type="number" required /></FormField><FormField label="Valor declarado"><Input defaultValue="R$ 4.890,00" required /></FormField></div></Card>
      <div className="flex flex-wrap justify-end gap-2"><Button render={<Link href="/logistica/postagens" />} variant="outline">Cancelar</Button><Button type="submit"><Save />Preparar demonstração</Button></div>
      {notice && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">{notice}</p>}
    </form>
  </Shell>;
}

export function PostingDetail({ id }: { id: string }) {
  const [status, setStatus] = useState("Em trânsito");
  const events = ["Objeto preparado no centro de distribuição", "Coleta registrada localmente", "Transferência para unidade de destino"];
  return <Shell back="/logistica/postagens" eyebrow="Logística / Postagens" title={id.toUpperCase()} description="Rastreamento e histórico operacional da postagem demonstrativa." actions={<Button disabled={status === "Entregue"} onClick={() => setStatus("Entregue")}><PackageCheck />Confirmar entrega local</Button>}>
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card title="Linha do tempo"><ol className="space-y-4">{events.map((event, index) => <li className="flex gap-3" key={event}><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs text-primary">{index + 1}</span><div><strong className="text-sm">{event}</strong><p className="text-xs text-muted-foreground">{25 - index}/10/2026 · evento demonstrativo</p></div></li>)}</ol></Card><Card title="Resumo"><dl className="grid gap-4"><Field label="Pedido" value="PV-1048" /><Field label="Destinatário" value="Academia Horizonte" /><Field label="Rastreio" value="BR123•••890" /><Field label="Situação" value={status} /></dl></Card></div>
    {status === "Entregue" && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">Entrega confirmada apenas nesta sessão.</p>}
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
  const initial = [{ name: "Banco regulável", expected: 2, checked: false }, { name: "Kit anilhas 20 kg", expected: 4, checked: false }, { name: "Barra olímpica", expected: 2, checked: false }];
  const [items, setItems] = useState(initial);
  const [closed, setClosed] = useState(false);
  const checked = useMemo(() => items.filter((item) => item.checked).length, [items]);
  return <Shell back="/logistica/checkout" eyebrow="Logística / Checkout" title={id.toUpperCase()} description="Conferência item a item antes da expedição." actions={<Button disabled={checked !== items.length || closed} onClick={() => setClosed(true)}><ShieldCheck />Concluir conferência</Button>}><Card className="mt-6" title={`Itens conferidos · ${checked}/${items.length}`}><div className="space-y-3">{items.map((item, index) => <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-4" key={item.name}><input className="size-5 accent-primary" checked={item.checked} onChange={(event) => { setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, checked: event.target.checked } : entry)); setClosed(false); }} type="checkbox" /><span className="min-w-0 flex-1 text-sm font-medium">{item.name}</span><span className="text-sm text-muted-foreground">{item.expected} un.</span></label>)}</div></Card>{closed && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">Checkout concluído localmente. Nenhuma baixa ou expedição foi realizada.</p>}</Shell>;
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
  return <Shell back="/logistica/envios" eyebrow="Logística / Ávila Envios" title="Simular cotação" description="Compare opções demonstrativas de prazo e preço sem consultar transportadoras."><form className="mt-6" onSubmit={(event) => { event.preventDefault(); setQuoted(true); }}><Card title="Origem, destino e carga"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Origem"><Input defaultValue="Votuporanga - SP" required /></FormField><FormField label="Destino"><Input defaultValue="Belo Horizonte - MG" required /></FormField><FormField label="Peso (kg)"><Input defaultValue="120" min="0.1" type="number" required /></FormField><FormField label="Volumes"><Input defaultValue="4" min="1" type="number" required /></FormField></div><Button className="mt-5" type="submit"><Truck />Calcular opções locais</Button></Card></form>{quoted && <div className="mt-5 grid gap-3 sm:grid-cols-3">{[["Transportadora A", "3 dias", "R$ 284,90"], ["Transportadora B", "5 dias", "R$ 241,30"], ["Transportadora C", "2 dias", "R$ 356,80"]].map(([name, time, price]) => <Card title={name} key={name}><p className="text-sm text-muted-foreground">{time}</p><strong className="mt-2 block text-xl">{price}</strong><Button className="mt-4" render={<Link href="/logistica/envios/COT-1842" />}>Ver e contratar</Button></Card>)}</div>}</Shell>;
}

export function ShippingDetail({ id }: { id: string }) {
  const [contracted, setContracted] = useState(false);
  const [tracking, setTracking] = useState(false);
  return <Shell back="/logistica/envios" eyebrow="Logística / Ávila Envios" title={id.toUpperCase()} description="Cotação, contratação e acompanhamento inteiramente demonstrativos." actions={<Button disabled={contracted} onClick={() => setContracted(true)}><Send />Contratar localmente</Button>}><div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><Card title="Frete selecionado"><dl className="grid gap-4 sm:grid-cols-2"><Field label="Transportadora" value="Transportadora A" /><Field label="Serviço" value="Expresso rodoviário" /><Field label="Prazo" value="3 dias úteis" /><Field label="Preço" value="R$ 284,90" /><Field label="Origem" value="Votuporanga - SP" /><Field label="Destino" value="Belo Horizonte - MG" /></dl></Card><Card title="Situação"><Truck className="size-6 text-primary" /><strong className="mt-4 block">{contracted ? (tracking ? "Em trânsito local" : "Contratado localmente") : "Cotação aberta"}</strong><p className="mt-2 text-sm text-muted-foreground">Nenhuma transportadora foi acionada.</p>{contracted && !tracking && <Button className="mt-4" variant="outline" onClick={() => setTracking(true)}><Clock3 />Iniciar acompanhamento</Button>}</Card></div>{contracted && <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status"><FileCheck2 className="mr-2 inline size-4" />Contratação registrada apenas nesta demonstração.</p>}</Shell>;
}
