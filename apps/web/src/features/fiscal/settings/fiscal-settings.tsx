"use client"
import { PageTitle } from "@/components/workspace/page-title"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Profile = Schema<"ProfileInput">
type Snapshot = Schema<"ProfileSnapshot">
type ProfileDraft = Omit<Profile, "environment" | "crt" | "series" | "nextNumber"> & { environment: "homologation" | "production" | ""; crt: number | ""; series: number | ""; nextNumber: number | "" }
type Company = { legalName: string; taxId: string; state: string; stateRegistration: string; taxRegime: string; city: string }
const empty: ProfileDraft = { environment: "", state: "", municipalityCode: "", stateRegistration: "", crt: "", series: "", nextNumber: "", certificateReference: "" }
const regimeLabels: Record<string, string> = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" }
const fiscalStages = [
  { id: "fiscal-stage-1", number: "1", title: "Emitente e endereço", summary: "Empresa, UF, inscrição estadual e município" },
  { id: "fiscal-stage-2", number: "2", title: "Certificados e credenciais", summary: "Certificado digital A1 e cofre" },
  { id: "fiscal-stage-3", number: "3", title: "Ambiente e comunicação", summary: "Homologação ou produção, sem emissão ao salvar" },
  { id: "fiscal-stage-4", number: "4", title: "Série e numeração", summary: "Sequência separada por empresa, ambiente e série" },
  { id: "fiscal-stage-5", number: "5", title: "Preferências de emissão", summary: "Naturezas de operação e NFC-e" },
  { id: "fiscal-stage-6", number: "6", title: "Impressão de DANFE", summary: "Geração a partir de XML autorizado" },
  { id: "fiscal-stage-7", number: "7", title: "E-mail e acesso ao XML", summary: "Entrega automática ainda não disponível" },
] as const

export function FiscalSettings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [draft, setDraft] = useState<ProfileDraft>(empty)
  const [baseline, setBaseline] = useState("")
  const [etag, setEtag] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef(false)
  const dirty = !!snapshot && JSON.stringify(draft) !== baseline
  const missing = company ? [
    !regimeLabels[company.taxRegime] && "Regime tributário no cadastro da empresa",
    !draft.state && "UF do emitente",
    !draft.stateRegistration && "Inscrição estadual",
    !draft.municipalityCode && "Código IBGE do município",
    draft.crt === "" && "Código de regime tributário",
    draft.series === "" && "Série da NF-e",
    draft.environment === "" && "Ambiente",
    draft.environment === "production" && draft.nextNumber === "" && "Próxima numeração da série em produção",
  ].filter(Boolean) : []

  useEffect(() => {
    const controller = new AbortController()
    Promise.all(["/api/erp/fiscal/config", "/api/erp/company"].map(async url => {
      const response = await erpFetch(url, { cache: "no-store", signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Configuração fiscal indisponível")
      return { value, etag: response.headers.get("etag") }
    })).then(([profile, registered]) => {
      if (controller.signal.aborted) return
      if (profile.value.tenantId !== registered.value.tenantId || !profile.etag) throw new Error("A empresa da sessão mudou. Recarregue a configuração")
      const data = registered.value.data as Company
      const value: ProfileDraft = profile.value.data ? { ...profile.value.data, nextNumber: profile.value.data.nextNumber ?? "" } : { ...empty }
      setSnapshot(profile.value); setCompany(data); setDraft(value); setBaseline(JSON.stringify(value)); setEtag(profile.etag); setBlocked(false); setError("")
    }).catch(reason => { if (!controller.signal.aborted) { setSnapshot(null); setError(reason.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot?.canEdit || pending.current || blocked || missing.length) return
    pending.current = true; setSaving(true); setError(""); setNotice("")
    try {
      const response = await erpFetch("/api/erp/fiscal/config", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag }, body: JSON.stringify({ ...draft, nextNumber: draft.nextNumber === "" ? undefined : draft.nextNumber }) })
      const value = await response.json()
      if (!response.ok) {
        if ([401, 403, 409, 412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw new Error(value.title || "Não foi possível confirmar a gravação")
      }
      const revision = response.headers.get("etag")
      if (!revision) { setBlocked(true); throw new Error("Gravação recebida sem revisão. Recarregue para conferir os dados") }
      const saved: ProfileDraft = { ...value.data, nextNumber: value.data.nextNumber ?? "" }
      setSnapshot(value); setDraft(saved); setBaseline(JSON.stringify(saved)); setEtag(revision); setNotice("Configuração fiscal salva no servidor. A transmissão é feita na nota fiscal.")
    } catch (reason) {
      if (reason instanceof TypeError) setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação. Recarregue antes de repetir")
    } finally { pending.current = false; setSaving(false) }
  }

  return <div className="mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div><p className="text-sm text-primary">Preferências / Fiscal</p><PageTitle className="mt-2 text-3xl font-semibold">Configurações fiscais</PageTitle><p className="mt-2 text-muted-foreground">{company ? `${company.legalName} · ${company.taxId}` : "Preparação fiscal da empresa ativa"}</p></div><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/monitor">Notas recebidas</Link></header>
    <nav aria-label="Etapas da configuração fiscal" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {fiscalStages.map(stage => <a key={stage.id} href={`#${stage.id}`} className="rounded-xl border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-xs font-semibold text-primary">Etapa {stage.number}</span><span className="mt-1 block text-sm font-medium">{stage.title}</span><span className="mt-1 block text-xs text-muted-foreground">{stage.summary}</span></a>)}
    </nav>
    {loading && <p role="status">Carregando configuração fiscal…</p>}
    {snapshot && company && <form onSubmit={save} className="space-y-6">
      {missing.length > 0 && <section aria-labelledby="fiscal-missing-title" className="form-section space-y-3"><h2 id="fiscal-missing-title" className="text-lg font-semibold">Dados para preencher</h2><p className="text-sm text-muted-foreground">Preencha todos os campos abaixo antes de salvar o perfil fiscal. As informações do cadastro da empresa estão disponíveis para conferência.</p><ul className="list-disc space-y-1 pl-5 text-sm">{missing.map(field => <li key={String(field)}>{field}</li>)}</ul></section>}
      <section id="fiscal-stage-1" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">1. Emitente e endereço</h2><p className="text-sm text-muted-foreground">UF, inscrição estadual e regime devem corresponder ao <Link className="text-primary underline" href="/preferencias/empresa/dados?secao=fiscal">cadastro da empresa</Link>.</p>
        <p className="text-sm">Regime tributário cadastrado: {regimeLabels[company.taxRegime] || "Não informado"}</p><Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href="/preferencias/empresa/dados?secao=fiscal">{regimeLabels[company.taxRegime] ? "Editar regime tributário" : "Preencher regime tributário"}</Link>
        <fieldset disabled={!snapshot.canEdit || saving || blocked} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">UF do emitente<Input value={draft.state} maxLength={2} required onChange={event => setDraft({ ...draft, state: event.target.value.toUpperCase() })} /><span className="text-xs text-muted-foreground">Cadastro atual: {company.state || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Inscrição estadual<Input value={draft.stateRegistration} inputMode="numeric" pattern="[0-9]{1,14}" required onChange={event => setDraft({ ...draft, stateRegistration: event.target.value })} /><span className="text-xs text-muted-foreground">Somente dígitos. Cadastro atual: {company.stateRegistration || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Código IBGE do município<Input value={draft.municipalityCode} inputMode="numeric" pattern="[0-9]{7}" maxLength={7} required onChange={event => setDraft({ ...draft, municipalityCode: event.target.value })} /><span className="text-xs text-muted-foreground">Município cadastrado: {company.city || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Código de regime tributário<select aria-label="Código de regime tributário" className="h-10 w-full rounded-xl border bg-background px-3" required value={draft.crt} onChange={event => setDraft({ ...draft, crt: event.target.value === "" ? "" : Number(event.target.value) })}><option value="">Selecione o CRT</option><option value={1}>1: Simples Nacional</option><option value={2}>2: Simples Nacional com excesso de sublimite</option><option value={3}>3: Regime normal</option><option value={4}>4: Simples Nacional (MEI)</option></select></label>
        </fieldset>
      </section>
      <section id="fiscal-stage-2" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">2. Certificados e credenciais</h2><p className="text-sm">Situação: {snapshot.certificateVerified ? "Certificado conectado e vigente" : "Nenhum certificado vigente disponível"}.</p><p className="text-sm text-muted-foreground">O arquivo e a senha são informados na tela própria do certificado, que confere o CNPJ, a validade e a cadeia de confiança.</p><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/certificado-digital">Gerenciar certificado A1</Link></section>
      <section id="fiscal-stage-3" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">3. Ambiente e comunicação</h2><p className="text-sm text-muted-foreground">O ambiente pertence à empresa ativa. Salvar esta tela apenas persiste a configuração; a transmissão fiscal ocorre em uma ação explícita da nota.</p><fieldset disabled={!snapshot.canEdit || saving || blocked} className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm">Ambiente<select aria-label="Ambiente" className="h-10 w-full rounded-xl border bg-background px-3" required value={draft.environment} onChange={event => setDraft({ ...draft, environment: event.target.value === "homologation" || event.target.value === "production" ? event.target.value : "", nextNumber: "" })}><option value="">Selecione o ambiente</option><option value="homologation">Homologação</option><option value="production">Produção</option></select><span className="text-xs text-muted-foreground">Homologação não tem valor fiscal. Produção exige numeração declarada e autorização separada.</span></label></fieldset></section>
      <section id="fiscal-stage-4" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">4. Série e numeração</h2><p className="text-sm text-muted-foreground">A sequência é controlada por empresa, ambiente e série. Números reservados não podem ser reutilizados nem reduzidos.</p><fieldset disabled={!snapshot.canEdit || saving || blocked} className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm">Série da NF-e<Input type="number" min={1} max={999} step={1} required placeholder="Informe a série" value={draft.series} onChange={event => setDraft({ ...draft, series: event.target.value === "" ? "" : Number(event.target.value), nextNumber: "" })} /></label><label className="space-y-2 text-sm">Próximo número da NF-e<Input aria-label="Próximo número da NF-e" type="number" min={1} max={999999999} step={1} required={draft.environment === "production"} value={draft.nextNumber} onChange={event => setDraft({ ...draft, nextNumber: event.target.value === "" ? "" : Number(event.target.value) })} /><span className="text-xs text-muted-foreground">Obrigatório para produção.</span></label></fieldset></section>
      <section id="fiscal-stage-5" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">5. Preferências de emissão e preenchimento</h2><p className="text-sm text-muted-foreground">Naturezas de operação e configuração de NFC-e são mantidas em telas próprias, com revisão concorrente e permissões no backend.</p><div className="flex flex-wrap gap-3"><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal/naturezas">Naturezas de operação</Link><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal/nfce">Preferências de NFC-e</Link></div></section>
      <section id="fiscal-stage-6" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">6. Impressão de DANFE</h2><p className="text-sm text-muted-foreground">A geração disponível recebe XML autorizado e preserva a conferência de assinatura, protocolo e hashes. Ela não autoriza nem transmite documentos.</p><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/danfe">Abrir geração de DANFE</Link></section>
      <section id="fiscal-stage-7" className="form-section scroll-mt-6 space-y-4"><h2 className="text-lg font-semibold">7. E-mail e pessoas autorizadas a acessar XML</h2><p className="text-sm text-muted-foreground">Cadastre o e-mail fiscal e as pessoas que podem acessar XML nesta empresa. Os dados são persistidos com revisão concorrente; o envio automático de XML/DANFE ainda depende de um serviço de entrega e não ocorre ao salvar.</p><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/fiscal/delivery">Configurar e-mail e acesso ao XML</Link></section>
      {!snapshot.canEdit && <p className="text-sm">Seu acesso permite apenas consultar a configuração fiscal.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!snapshot.canEdit || saving || blocked || !dirty || missing.length > 0}>{saving ? "Salvando…" : "Salvar configuração fiscal"}</Button>{dirty && <span className="text-sm text-muted-foreground">Alterações ainda não salvas</span>}</div>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error} Sua edição foi preservada.</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {(blocked || !snapshot && !loading) && <Button variant="outline" onClick={() => { if (!dirty || window.confirm("Descartar a edição e carregar os dados atuais do servidor?")) { setLoading(true); setNotice(""); setReload(value => value + 1) } }}>Recarregar dados do servidor</Button>}
  </div>
}
