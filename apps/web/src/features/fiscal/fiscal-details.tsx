"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  CheckCircle2,
  FileDown,
  History,
  Radio,
  ReceiptText,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type DocumentKind = "nfe" | "nfce"

const xmlPreview = `<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe352610...0183">
      <dest><xNome>Studio Força Total</xNome></dest>
      <total><vNF>7240.00</vNF></total>
    </infNFe>
  </NFe>
</nfeProc>`

export function FiscalDocumentDetail({ id, kind }: { id: string; kind: DocumentKind }) {
  const isNfce = kind === "nfce"
  const [status, setStatus] = useState(isNfce ? "Simulada" : "Autorizada (simulação)")
  const [notice, setNotice] = useState("")
  const [event, setEvent] = useState("")

  function registerEvent() {
    if (!event.trim()) return
    setNotice(`Evento “${event.trim()}” registrado somente nesta demonstração.`)
    setEvent("")
  }

  return (
    <FiscalDetailShell
      back={isNfce ? "/fiscal/nfce" : "/fiscal/notas-saida"}
      eyebrow={isNfce ? "Fiscal / NFC-e" : "Fiscal / NF-e de saída"}
      title={id.toUpperCase()}
      description={
        isNfce
          ? "Detalhe demonstrativo do cupom fiscal vinculado ao PDV. Não existe autorização fiscal real."
          : "Documento demonstrativo com eventos e arquivos sanitizados. Nada é transmitido à SEFAZ."
      }
      actions={
        <>
          {isNfce && (
            <Button
              variant="outline"
              onClick={() => {
                setStatus("Contingência simulada")
                setNotice("Contingência marcada apenas na interface; nenhum cupom foi transmitido.")
              }}
            >
              <Radio />
              Simular contingência
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={status === "Cancelada localmente"}
            onClick={() => {
              setStatus("Cancelada localmente")
              setNotice("Cancelamento registrado localmente; nenhum evento fiscal foi enviado.")
            }}
          >
            <XCircle />
            Cancelar localmente
          </Button>
        </>
      }
    >
      <DemoNotice />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <FiscalCard title="Documento">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Destinatário" value={isNfce ? "Consumidor final" : "Studio Força Total"} />
            <Fact label="Situação" value={status} />
            <Fact label="Série" value={isNfce ? "65" : "1"} />
            <Fact label="Valor" value={isNfce ? "R$ 680,00" : "R$ 7.240,00"} />
            <Fact label="Chave sanitizada" value="3526…0183" />
            <Fact label="Origem" value={isNfce ? "PDV · Caixa 01" : "Pedido PV-1047"} />
          </dl>
        </FiscalCard>
        <FiscalCard title="Arquivos demonstrativos">
          <div className="grid gap-3">
            <Button
              variant="outline"
              onClick={() => setNotice("Prévia do XML exibida abaixo; nenhum arquivo oficial foi baixado.")}
            >
              <Braces />
              Visualizar XML sanitizado
            </Button>
            <Button
              variant="outline"
              onClick={() => setNotice(`${isNfce ? "DANFCE" : "DANFE"} não gerado: integração fiscal indisponível.`)}
            >
              <FileDown />
              Simular {isNfce ? "DANFCE" : "DANFE"}
            </Button>
          </div>
        </FiscalCard>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <FiscalCard title="Registrar evento local">
          <label className="text-sm font-medium" htmlFor="fiscal-event">Descrição do evento</label>
          <Textarea
            className="mt-2"
            id="fiscal-event"
            placeholder="Ex.: correção de endereço para revisão"
            value={event}
            onChange={(event) => setEvent(event.target.value)}
          />
          <Button className="mt-3" disabled={!event.trim()} onClick={registerEvent}>
            <History />
            Registrar na demonstração
          </Button>
        </FiscalCard>
        <FiscalCard title="Histórico">
          <ol className="space-y-3 text-sm">
            <li><strong>25/10/2026 · 09:42</strong><span className="block text-muted-foreground">Documento carregado no ambiente demonstrativo.</span></li>
            <li><strong>25/10/2026 · 09:44</strong><span className="block text-muted-foreground">Validação visual concluída, sem comunicação externa.</span></li>
          </ol>
        </FiscalCard>
      </div>
      <FiscalCard className="mt-5" title="Prévia segura do XML">
        <pre className="max-w-full overflow-x-auto rounded-xl bg-muted p-4 text-xs leading-6" aria-label="Prévia sanitizada do XML">{xmlPreview}</pre>
      </FiscalCard>
    </FiscalDetailShell>
  )
}

export function MonitorDocumentDetail({ id }: { id: string }) {
  const [manifestation, setManifestation] = useState("Ciência pendente")
  const [notice, setNotice] = useState("")
  const choices = ["Ciência da operação", "Confirmação da operação", "Operação desconhecida"]
  return (
    <FiscalDetailShell
      back="/fiscal/monitor"
      eyebrow="Fiscal / Monitor de documentos"
      title={id.toUpperCase()}
      description="Resumo local de distribuição fiscal. Nenhuma consulta, download ou manifestação é enviada aos serviços oficiais."
    >
      <DemoNotice />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      <div className="grid gap-5 lg:grid-cols-2">
        <FiscalCard title="Documento monitorado">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Tipo" value="NF-e recebida" />
            <Fact label="Emitente" value="Aço Forte" />
            <Fact label="CNPJ" value="38.***.***/0001-**" />
            <Fact label="Valor" value="R$ 48.320,00" />
            <Fact label="NSU" value={id.toUpperCase()} />
            <Fact label="Manifestação" value={manifestation} />
          </dl>
        </FiscalCard>
        <FiscalCard title="Manifestação demonstrativa">
          <div className="grid gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                variant={manifestation === choice ? "default" : "outline"}
                onClick={() => {
                  setManifestation(choice)
                  setNotice(`${choice} salva apenas nesta tela; nenhum evento foi transmitido.`)
                }}
              >
                <ShieldCheck />
                {choice}
              </Button>
            ))}
          </div>
        </FiscalCard>
      </div>
      <FiscalCard className="mt-5" title="Disponibilidade de documentos">
        <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <p>Somente o resumo demonstrativo está disponível. XML completo e DANFE dependem de manifestação e integração autorizada.</p>
        </div>
      </FiscalCard>
    </FiscalDetailShell>
  )
}

export function TaxGuideDetail({ id }: { id: string }) {
  const [status, setStatus] = useState("A revisar")
  const [notice, setNotice] = useState("")
  return (
    <FiscalDetailShell
      back="/fiscal/guias"
      eyebrow="Fiscal / Guias tributárias"
      title={id.toUpperCase()}
      description="Acompanhamento local de GNRE ou DARE-SP. Não há cálculo, emissão bancária ou pagamento real."
      actions={
        <Button
          onClick={() => {
            setStatus("Gerada localmente")
            setNotice("Prévia da guia preparada localmente; nenhum documento oficial foi emitido.")
          }}
        >
          <ReceiptText />
          Gerar prévia local
        </Button>
      }
    >
      <DemoNotice />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      <div className="grid gap-5 lg:grid-cols-2">
        <FiscalCard title="Dados da guia">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Tributo" value={id.endsWith("090") ? "DARE-SP · ICMS" : "GNRE · ICMS-ST"} />
            <Fact label="Situação" value={status} />
            <Fact label="Referência" value="Outubro/2026" />
            <Fact label="Vencimento" value="31/10/2026" />
            <Fact label="Valor demonstrativo" value="R$ 1.284,20" />
            <Fact label="Empresa" value="Ludus Equipamentos" />
          </dl>
        </FiscalCard>
        <FiscalCard title="Acompanhamento">
          <Button
            variant="outline"
            disabled={status === "Conferida localmente"}
            onClick={() => {
              setStatus("Conferida localmente")
              setNotice("Conferência registrada somente no navegador.")
            }}
          >
            <CheckCircle2 />
            Marcar como conferida
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">Pagamento e comprovante permanecem indisponíveis até a integração autorizada.</p>
        </FiscalCard>
      </div>
    </FiscalDetailShell>
  )
}

export function TaxGuideForm() {
  const [saved, setSaved] = useState(false)
  return (
    <FiscalDetailShell
      back="/fiscal/guias"
      eyebrow="Fiscal / Guias tributárias"
      title="Nova simulação de guia"
      description="Prepare dados para revisão visual sem consultar, calcular ou emitir uma guia oficial."
    >
      <DemoNotice />
      {saved && <StatusNotice>Simulação salva localmente; nenhum documento oficial foi criado.</StatusNotice>}
      <form
        className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault()
          setSaved(true)
        }}
      >
        <Field label="Tipo de guia"><select className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue="GNRE"><option>GNRE</option><option>DARE-SP</option></select></Field>
        <Field label="Referência"><Input defaultValue="Outubro/2026" /></Field>
        <Field label="UF favorecida"><Input defaultValue="MG" maxLength={2} /></Field>
        <Field label="Vencimento"><Input defaultValue="2026-10-31" type="date" /></Field>
        <Field label="Valor demonstrativo"><Input defaultValue="1284,20" inputMode="decimal" /></Field>
        <Field label="Código de receita"><Input defaultValue="10009-9" /></Field>
        <div className="sm:col-span-2"><Field label="Observações"><Textarea defaultValue="Simulação para conferência interna." /></Field></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit"><Save />Salvar simulação</Button>
          <Button type="reset" variant="outline" onClick={() => setSaved(false)}>Restaurar</Button>
        </div>
      </form>
    </FiscalDetailShell>
  )
}

function FiscalDetailShell({ back, eyebrow, title, description, actions, children }: { back: string; eyebrow: string; title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
      <Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={back}><ArrowLeft className="size-4" />Voltar</Link>
      <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-sm font-medium text-primary">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{description}</p></div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="mt-6">{children}</div>
    </main>
  )
}

function DemoNotice() {
  return <div className="mb-5 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-muted-foreground"><AlertTriangle className="size-5 shrink-0 text-amber-500" /><p>Ambiente de frontend: nenhuma operação fiscal, consulta, arquivo ou pagamento é transmitido ou persistido.</p></div>
}

function StatusNotice({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm" role="status">{children}</p>
}

function FiscalCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-5 sm:p-6 ${className}`}><h2 className="mb-5 font-semibold">{title}</h2>{children}</section>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>
}
