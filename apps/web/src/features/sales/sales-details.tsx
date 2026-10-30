"use client";

import { UnavailableImport } from "@/components/unavailable-import";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  CircleX,
  Clock3,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Notice = { tone: "success" | "warning"; text: string } | null;

const order = {
  customer: "Academia Horizonte",
  seller: "Mariana Costa",
  payment: "Boleto 28 dias",
  total: "R$ 18.490,00",
};

export function SalesOrderDetail({ id }: { id: string }) {
  const [status, setStatus] = useState("Aguardando aprovação");
  const [notice, setNotice] = useState<Notice>(null);
  const code = id.toUpperCase();
  function decide(next: string) {
    setStatus(next);
    setNotice({
      tone: next === "Cancelado" ? "warning" : "success",
      text: `${code} marcado como ${next.toLocaleLowerCase("pt-BR")} apenas nesta sessão.`,
    });
  }
  return (
    <SalesShell
      back="/vendas/pedidos"
      eyebrow="Vendas / Pedidos"
      title={code}
      description="Aprovação, cancelamento, itens e histórico demonstrativo do pedido."
      actions={
        <>
          <Button variant="outline" onClick={() => decide("Cancelado")} disabled={status === "Cancelado"}>
            <CircleX /> Cancelar
          </Button>
          <Button onClick={() => decide("Aprovado")} disabled={status === "Aprovado"}>
            <CheckCircle2 /> Aprovar
          </Button>
          <ActionLink href={`/vendas/pedidos/${id}/editar`}><Pencil /> Editar</ActionLink>
        </>
      }
    >
      <NoticeBox notice={notice} />
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Itens do pedido">
          <Item name="Leg Press 45° Profissional" detail="SKU LP45-LD · 1 unidade" value="R$ 12.990,00" />
          <Item name="Banco Regulável Ludus" detail="SKU BR-500 · 2 unidades" value="R$ 5.500,00" />
        </Card>
        <Card title="Resumo">
          <Facts values={[["Cliente", order.customer], ["Vendedor", order.seller], ["Pagamento", order.payment], ["Situação", status], ["Total", order.total]]} />
        </Card>
      </div>
      <Card className="mt-5" title="Histórico">
        <Timeline entries={["Pedido criado por Mariana Costa", "Análise comercial iniciada", status === "Aguardando aprovação" ? "Aguardando decisão" : `Situação alterada para ${status}`]} />
      </Card>
      <LocalOnly />
    </SalesShell>
  );
}

export function SalesOrderEdit({ id }: { id: string }) {
  return <RecordForm kind="Pedido" id={id} back={`/vendas/pedidos/${id}`} fields={["Cliente", "Vendedor", "Forma de pagamento", "Data prevista"]} />;
}

export function ProposalForm({ id }: { id?: string }) {
  const [version, setVersion] = useState(id ? 3 : 1);
  const [saved, setSaved] = useState(false);
  return (
    <SalesShell back={id ? `/vendas/propostas/${id}` : "/vendas/propostas"} eyebrow="Vendas / Propostas" title={id ? `Editar ${id.toUpperCase()}` : "Nova proposta"} description="Crie uma versão comercial local para validar conteúdo, valores e validade.">
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
        <Card title="Dados comerciais">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente"><Input defaultValue="Arena Performance" required /></Field>
            <Field label="Validade"><Input defaultValue="2026-11-04" type="date" required /></Field>
            <Field label="Versão"><Input readOnly value={version} /></Field>
            <Field label="Condição"><select defaultValue="30% entrada + 2 parcelas"><option>30% entrada + 2 parcelas</option><option>À vista</option></select></Field>
          </div>
        </Card>
        <Card title="Proposta"><Item name="Linha completa de musculação" detail="Entrega e montagem inclusas" value="R$ 42.900,00" /></Card>
        {saved && <Status>Versão {version} salva somente nesta sessão.</Status>}
        <div className="flex flex-wrap justify-end gap-2">
          {id && <Button type="button" variant="outline" onClick={() => { setVersion((value) => value + 1); setSaved(false); }}><Plus /> Criar nova versão</Button>}
          <Button type="submit"><Save /> Salvar versão local</Button>
        </div>
      </form>
    </SalesShell>
  );
}

export function ProposalDetail({ id }: { id: string }) {
  const [status, setStatus] = useState("Enviada");
  const [notice, setNotice] = useState<Notice>(null);
  const code = id.toUpperCase();
  return (
    <SalesShell back="/vendas/propostas" eyebrow="Vendas / Propostas" title={code} description="Versões, aprovação e condições da proposta comercial." actions={<><Button variant="outline" onClick={() => { setStatus("Rejeitada"); setNotice({ tone: "warning", text: "Proposta rejeitada somente nesta demonstração." }); }}><CircleX /> Rejeitar</Button><Button onClick={() => { setStatus("Aceita"); setNotice({ tone: "success", text: "Proposta aceita somente nesta demonstração." }); }}><BadgeCheck /> Aprovar</Button><ActionLink href={`/vendas/propostas/${id}/editar`}><Pencil /> Editar</ActionLink></>}>
      <NoticeBox notice={notice} />
      <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card title="Resumo"><Facts values={[["Cliente", "Arena Performance"], ["Versão atual", "3"], ["Validade", "04/11/2026"], ["Situação", status], ["Total", "R$ 42.900,00"]]} /></Card><Card title="Versões"><Timeline entries={["Versão 1 · escopo inicial", "Versão 2 · frete revisado", "Versão 3 · montagem inclusa"]} /></Card></div>
      <LocalOnly />
    </SalesShell>
  );
}

export function AdForm({ id }: { id?: string }) {
  return <RecordForm kind="Anúncio" id={id} back={id ? `/vendas/anuncios/${id}` : "/vendas/anuncios"} fields={["Título", "SKU", "Canal", "Preço"]} />;
}

export function AdDetail({ id }: { id: string }) {
  const [published, setPublished] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const code = id.toUpperCase();
  return (
    <SalesShell back="/vendas/anuncios" eyebrow="Vendas / Anúncios" title={code} description="Conteúdo, canal e saúde da publicação demonstrativa." actions={<><Button variant="outline" onClick={() => { setPublished(!published); setNotice({ tone: "success", text: `Anúncio ${published ? "pausado" : "publicado"} apenas nesta sessão.` }); }}><UploadCloud /> {published ? "Pausar" : "Publicar"}</Button><ActionLink href={`/vendas/anuncios/${id}/editar`}><Pencil /> Editar</ActionLink></>}>
      <NoticeBox notice={notice} />
      <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card title="Publicação"><Facts values={[["Produto", "Leg Press 45° Profissional"], ["SKU", "LP45-LD"], ["Canal", "Mercado Livre"], ["Situação", published ? "Publicado" : "Pausado"], ["Preço", "R$ 12.990,00"]]} /></Card><Card title="Qualidade"><Facts values={[["Título", "Ótimo"], ["Imagens", "6 de 6"], ["Atributos", "100% preenchidos"], ["Última sincronização", "Há 8 minutos"]]} /></Card></div>
      <LocalOnly />
    </SalesShell>
  );
}

export function WarrantyForm() {
  return <RecordForm kind="Solicitação de garantia" back="/vendas/garantias" fields={["Cliente", "Pedido", "Produto", "Motivo"]} />;
}

export function WarrantyDetail({ id }: { id: string }) {
  const [stage, setStage] = useState("Em análise");
  return (
    <SalesShell back="/vendas/garantias" eyebrow="Vendas / Garantias" title={id.toUpperCase()} description="Prazo, evidências e acompanhamento local da solicitação." actions={<Button onClick={() => setStage(stage === "Em análise" ? "Aprovada" : "Encerrada")}><ShieldCheck /> {stage === "Em análise" ? "Aprovar" : "Encerrar"}</Button>}>
      <div className="grid gap-5 lg:grid-cols-2"><Card title="Solicitação"><Facts values={[["Cliente", "Academia Horizonte"], ["Produto", "Leg Press 45°"], ["Motivo", "Ruído no rolamento"], ["Prazo restante", "18 dias"], ["Situação", stage]]} /></Card><Card title="Acompanhamento"><Timeline entries={["Solicitação aberta", "Fotos recebidas", "Análise técnica iniciada", stage]} /></Card></div>
      <Status>Alterações de etapa ficam somente nesta sessão.</Status>
    </SalesShell>
  );
}

export function PosClosing({ mode }: { mode: "fechamento" | "historico" }) {
  const [closed, setClosed] = useState(false);
  const history = [["CX-0081", "24/10/2026", "R$ 18.430,00", "Fechado"], ["CX-0080", "23/10/2026", "R$ 12.940,00", "Fechado"]];
  return (
    <SalesShell back="/vendas/pdv" eyebrow="Vendas / Frente de caixa" title={mode === "fechamento" ? "Fechamento de caixa" : "Histórico de caixas"} description="Conferência demonstrativa sem baixa ou conciliação financeira.">
      {mode === "fechamento" ? <><div className="grid gap-5 lg:grid-cols-3"><Card title="Dinheiro"><strong className="text-2xl">R$ 3.240,00</strong></Card><Card title="Pix"><strong className="text-2xl">R$ 8.990,00</strong></Card><Card title="Cartões"><strong className="text-2xl">R$ 6.200,00</strong></Card></div><Card className="mt-5" title="Conferência"><Field label="Valor contado"><Input defaultValue="18430.00" min="0" step="0.01" type="number" /></Field><Button className="mt-5" disabled={closed} onClick={() => setClosed(true)}><WalletCards /> Confirmar fechamento local</Button>{closed && <Status>Caixa fechado somente nesta demonstração.</Status>}</Card></> : <Card title="Últimos fechamentos">{history.map((entry) => <Item key={entry[0]} name={`${entry[0]} · ${entry[1]}`} detail={entry[3]} value={entry[2]} />)}</Card>}
    </SalesShell>
  );
}

export function StoreOperations() {
  const [notice, setNotice] = useState<Notice>(null);
  const products = [["LP45-LD", "Leg Press 45°", "Sincronizado"], ["BR-500", "Banco Regulável", "Pendente"], ["CA-200", "Crossover Angular", "Atenção"]];
  return (
    <SalesShell back="/vendas" eyebrow="Vendas" title="Loja virtual" description="Gestão visual demonstrativa do catálogo conectado à Ávila Lojas.">
      <div className="grid gap-4 sm:grid-cols-3"><MiniMetric label="Produtos" value="148" /><MiniMetric label="Pedidos hoje" value="7" /><MiniMetric label="Pendências" value="2" /></div>
      <Card className="mt-5" title="Catálogo"><div className="divide-y divide-border">{products.map(([sku, name, status]) => <Item key={sku} name={name} detail={sku} value={status} />)}</div><Button className="mt-5" onClick={() => setNotice({ tone: "success", text: "Sincronização simulada concluída. Nenhum catálogo externo foi alterado." })}><RefreshCw /> Sincronizar demonstração</Button></Card>
      <NoticeBox notice={notice} />
    </SalesShell>
  );
}

export function ImportOrdersWizard() {
  return <UnavailableImport title="Importar pedidos" backHref="/vendas/pedidos" backLabel="Consultar pedidos" />
}

export function SalesReportOperations() {
  const [notice, setNotice] = useState<Notice>(null);
  const [period, setPeriod] = useState("Últimos 30 dias");
  return (
    <SalesShell back="/vendas" eyebrow="Vendas" title="Relatórios de vendas" description="Filtros, comparação e exportação demonstrativa de indicadores comerciais.">
      <Card title="Filtros"><div className="grid gap-4 sm:grid-cols-3"><Field label="Período"><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>Últimos 30 dias</option><option>Este trimestre</option><option>Este ano</option></select></Field><Field label="Canal"><select><option>Todos</option><option>Loja virtual</option><option>Vendedores</option></select></Field><Field label="Comparar com"><select><option>Período anterior</option><option>Ano anterior</option></select></Field></div></Card>
      <div className="mt-5 grid gap-4 sm:grid-cols-3"><MiniMetric label="Receita" value="R$ 184.320" /><MiniMetric label="Pedidos" value="32" /><MiniMetric label="Conversão" value="31,8%" /></div>
      <Card className="mt-5" title={`Resumo · ${period}`}><Item name="Equipamentos de força" detail="18 pedidos" value="R$ 132.400" /><Item name="Acessórios" detail="14 pedidos" value="R$ 51.920" /><Button className="mt-5" variant="outline" onClick={() => setNotice({ tone: "success", text: "Exportação simulada. Nenhum arquivo real foi gerado." })}><Download /> Exportar demonstração</Button></Card>
      <NoticeBox notice={notice} />
    </SalesShell>
  );
}

function RecordForm({ kind, id, back, fields }: { kind: string; id?: string; back: string; fields: string[] }) {
  const [saved, setSaved] = useState(false);
  const title = id ? `Editar ${id.toUpperCase()}` : `Novo ${kind.toLocaleLowerCase("pt-BR")}`;
  return <SalesShell back={back} eyebrow="Vendas" title={title} description={`${kind} demonstrativo sem persistência ou integração externa.`}><form onSubmit={(event) => { event.preventDefault(); setSaved(true); }}><Card title="Dados"><div className="grid gap-4 sm:grid-cols-2">{fields.map((field, index) => <Field key={field} label={field}><Input defaultValue={id ? ["Academia Horizonte", "PV-1048", "Leg Press 45°", "Análise local"][index] ?? "Demonstração" : ""} required /></Field>)}</div></Card>{saved && <Status>{kind} salvo somente nesta sessão.</Status>}<div className="mt-5 flex justify-end"><Button type="submit"><Save /> Salvar localmente</Button></div></form></SalesShell>;
}

function SalesShell({ back, eyebrow, title, description, actions, children }: { back: string; eyebrow: string; title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6"><Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" /> Voltar</Link><header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-medium text-primary">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{description}</p></div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</header><div className="mt-6">{children}</div></div>;
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) { return <section className={`rounded-2xl border border-border bg-card p-5 sm:p-6 ${className}`}><h2 className="mb-5 font-semibold">{title}</h2>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2 text-sm font-medium [&_select]:h-10 [&_select]:rounded-lg [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:px-3">{label}{children}</label>; }
function Facts({ values }: { values: string[][] }) { return <dl className="grid gap-4 sm:grid-cols-2">{values.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>; }
function Item({ name, detail, value }: { name: string; detail: string; value: string }) { return <div className="grid gap-2 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong className="text-sm">{name}</strong><p className="text-xs text-muted-foreground">{detail}</p></div><span className="text-sm font-medium">{value}</span></div>; }
function Timeline({ entries }: { entries: string[] }) { return <ol className="space-y-3">{entries.map((entry, index) => <li className="flex gap-3 text-sm" key={`${entry}-${index}`}><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" /><span>{entry}</span></li>)}</ol>; }
function ActionLink({ href, children }: { href: string; children: React.ReactNode }) { return <Link className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm font-medium hover:bg-muted [&_svg]:size-4" href={href}>{children}</Link>; }
function NoticeBox({ notice }: { notice: Notice }) { if (!notice) return null; return <p className={`mt-5 rounded-xl border p-4 text-sm ${notice.tone === "success" ? "border-emerald-500/20 bg-emerald-500/10" : "border-amber-500/20 bg-amber-500/10"}`} role="status">{notice.text}</p>; }
function Status({ children }: { children: React.ReactNode }) { return <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">{children}</p>; }
function LocalOnly() { return <p className="mt-5 text-xs text-muted-foreground">Todas as ações desta tela são locais. Nenhum estoque, cobrança, canal ou documento externo foi alterado.</p>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-border bg-card p-5"><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>; }
