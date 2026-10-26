"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, ShieldAlert, Upload } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"

const steps = ["Entidade", "Arquivo", "Mapeamento", "Validação", "Prévia", "Resumo"]
const fields = ["Código", "Descrição", "Preço", "Estoque inicial"]

export function DataImport() {
  const [step, setStep] = useState(0)
  const [entity, setEntity] = useState("Produtos")
  const [fileName, setFileName] = useState("")
  const canAdvance = step !== 1 || Boolean(fileName)

  return <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Dados" title="Importação de dados" description="Prepare e valide uma importação localmente antes de qualquer integração com o backend." />
    <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Etapas da importação">{steps.map((label, index) => <li key={label} className={`rounded-xl border px-3 py-2 text-xs ${index === step ? "border-primary bg-primary/10 text-primary" : index < step ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-border text-muted-foreground"}`} aria-current={index === step ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>
    <section className="form-section min-h-80" aria-live="polite">
      {step === 0 && <Step title="Escolha a entidade" description="A estrutura esperada muda de acordo com o cadastro selecionado."><div className="grid gap-3 sm:grid-cols-3">{["Produtos", "Clientes e fornecedores", "Contas financeiras"].map((item) => <label className="check-card" key={item}><input type="radio" name="entity" checked={entity === item} onChange={() => setEntity(item)} />{item}</label>)}</div></Step>}
      {step === 1 && <Step title="Selecione o arquivo" description="O arquivo permanece neste navegador e não é transmitido."><label className="grid cursor-pointer place-items-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center"><Upload className="size-8 text-primary" /><strong>{fileName || "Selecionar CSV ou XLSX"}</strong><span className="text-sm text-muted-foreground">Máximo demonstrativo: 10 MB</span><input className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} /></label></Step>}
      {step === 2 && <Step title="Mapeie as colunas" description={`Correspondência simulada para ${entity}.`}><div className="space-y-3">{fields.map((field) => <label className="grid gap-2 rounded-xl border border-border p-3 text-sm sm:grid-cols-2 sm:items-center" key={field}><span>{field}</span><select className="h-10 rounded-lg border border-input bg-background px-3"><option>{field}</option><option>Ignorar coluna</option></select></label>)}</div></Step>}
      {step === 3 && <Step title="Validação local" description="Corrija os itens antes de continuar."><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-muted-foreground"><tr><th className="p-3">Linha</th><th className="p-3">Coluna</th><th className="p-3">Motivo</th><th className="p-3">Estado</th></tr></thead><tbody><tr className="border-t border-border"><td className="p-3">18</td><td className="p-3">Preço</td><td className="p-3">Separador decimal inválido</td><td className="p-3 text-amber-500">Revisar</td></tr><tr className="border-t border-border"><td className="p-3">31</td><td className="p-3">Código</td><td className="p-3">Valor duplicado</td><td className="p-3 text-destructive">Erro</td></tr></tbody></table></div></Step>}
      {step === 4 && <Step title="Prévia" description="Amostra local dos dados normalizados."><div className="grid gap-3 sm:grid-cols-3">{["120 linhas", "118 válidas", "2 com atenção"].map((item) => <div className="rounded-xl border border-border bg-background p-4 text-sm font-medium" key={item}>{item}</div>)}</div></Step>}
      {step === 5 && <Step title="Configuração concluída" description="Nenhuma importação real foi executada."><div className="flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"><CheckCircle2 className="size-5 text-emerald-500" /><p className="text-sm">A execução futura exigirá idempotência, auditoria e isolamento pelo tenant da sessão.</p></div></Step>}
    </section>
    <div className="mt-5 flex items-center justify-between gap-3"><Button variant="outline" disabled={step === 0} onClick={() => setStep((value) => value - 1)}><ArrowLeft />Voltar</Button><span className="hidden text-xs text-muted-foreground sm:inline"><ShieldAlert className="mr-1 inline size-3" />Demonstração sem transmissão</span>{step < steps.length - 1 ? <Button disabled={!canAdvance} onClick={() => setStep((value) => value + 1)}>Continuar<ArrowRight /></Button> : <Button onClick={() => setStep(0)}><FileSpreadsheet />Nova simulação</Button>}</div>
  </div>
}

function Step({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <><h2 className="text-xl font-semibold">{title}</h2><p className="mb-6 mt-2 text-sm text-muted-foreground">{description}</p>{children}</>
}
