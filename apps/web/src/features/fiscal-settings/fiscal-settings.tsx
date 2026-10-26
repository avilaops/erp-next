"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, FileCheck2, ReceiptText, Save } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function FiscalSettings() {
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [environment, setEnvironment] = useState("Homologação")
  const [documents, setDocuments] = useState(["NF-e"])
  function toggle(item: string) { setDocuments((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]); setDirty(true); setSaved(false) }
  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Fiscal" title="Configurações fiscais" description="Organize parâmetros para homologação sem afirmar que a emissão fiscal está ativa." />
    <div className="form-actions mb-6"><span className="mr-auto text-sm text-muted-foreground" role="status">{saved ? "Alterações salvas localmente" : dirty ? "Alterações não salvas" : "Cadastro incompleto"}</span><Button disabled={!dirty} onClick={() => { setDirty(false); setSaved(true) }}><Save />Salvar</Button></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-3"><StatusCard icon={AlertTriangle} title="Cadastro fiscal" value="Incompleto" /><StatusCard icon={FileCheck2} title="Certificado" value="Não configurado" /><StatusCard icon={CheckCircle2} title="Próxima etapa" value="Pronto para homologação após revisão" /></div>
    <div className="space-y-6">
      <Section title="Tributação" description="Dados vinculados à empresa ativa Ludus Equipamentos."><div className="form-grid"><Field label="Regime tributário"><select defaultValue="" onChange={() => setDirty(true)}><option value="" disabled>Selecionar</option><option>Simples Nacional</option><option>Lucro Presumido</option><option>Lucro Real</option></select></Field><Field label="CNAE principal"><Input value="" placeholder="Não informado no cadastro da empresa" readOnly /></Field></div></Section>
      <Section title="Inscrições" description="A fonte canônica permanece no cadastro empresarial."><div className="form-grid"><Field label="Inscrição estadual"><Input value="718.319.130.117" readOnly /></Field><Field label="Inscrição municipal"><Input value="" placeholder="Não informada" readOnly /></Field></div></Section>
      <Section title="Ambiente e documentos" description="Seleções locais para preparação da homologação."><fieldset><legend className="mb-3 text-sm font-medium">Ambiente</legend><div className="flex flex-wrap gap-3">{["Homologação", "Produção"].map((item) => <label className="check-card" key={item}><input type="radio" name="environment" checked={environment === item} onChange={() => { setEnvironment(item); setDirty(true) }} />{item}</label>)}</div></fieldset><fieldset className="mt-5"><legend className="mb-3 text-sm font-medium">Documentos habilitados</legend><div className="flex flex-wrap gap-3">{["NF-e", "NFC-e", "CT-e", "NFS-e"].map((item) => <label className="check-card" key={item}><input type="checkbox" checked={documents.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div></fieldset></Section>
      <Section title="Séries" description="Nenhuma numeração real será consumida."><div className="grid gap-3 sm:grid-cols-2">{documents.map((item) => <div className="flex items-center gap-3 rounded-xl border border-border p-4" key={item}><ReceiptText className="size-5 text-muted-foreground" /><span className="flex-1 text-sm">{item}</span><span className="text-xs text-muted-foreground">Série não configurada</span></div>)}</div></Section>
    </div>
  </div>
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="form-section"><h2 className="text-lg font-semibold">{title}</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">{description}</p>{children}</section> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field">{label}{children}</label> }
function StatusCard({ icon: Icon, title, value }: { icon: typeof AlertTriangle; title: string; value: string }) { return <div className="rounded-2xl border border-border bg-card p-4"><Icon className="size-5 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{title}</p><strong className="mt-1 block text-sm">{value}</strong></div> }
