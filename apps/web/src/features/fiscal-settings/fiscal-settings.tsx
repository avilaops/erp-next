"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Profile = { environment: "homologation"; state: string; municipalityCode: string; stateRegistration: string; crt: number; series: number; certificateReference: string }
type ProfileDraft = Omit<Profile, "crt" | "series"> & { crt: number | ""; series: number | "" }
type Snapshot = { tenantId: string; revision: number; canEdit: boolean; certificateVerified: boolean; data: Profile | null }
type Company = { legalName: string; taxId: string; state: string; stateRegistration: string; taxRegime: string; city: string }
const empty: ProfileDraft = { environment: "homologation", state: "", municipalityCode: "", stateRegistration: "", crt: "", series: "", certificateReference: "" }
const regimeLabels: Record<string, string> = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" }

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
  ].filter(Boolean) : []

  useEffect(() => {
    const controller = new AbortController()
    Promise.all(["/api/erp/fiscal/config", "/api/erp/company"].map(async url => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Configuração fiscal indisponível")
      return { value, etag: response.headers.get("etag") }
    })).then(([profile, registered]) => {
      if (controller.signal.aborted) return
      if (profile.value.tenantId !== registered.value.tenantId || !profile.etag) throw new Error("A empresa da sessão mudou. Recarregue a configuração")
      const data = registered.value.data as Company
      const value: ProfileDraft = profile.value.data || { ...empty, state: data.state, stateRegistration: data.stateRegistration, crt: data.taxRegime === "simples" ? 1 : ["real", "presumido"].includes(data.taxRegime) ? 3 : "" }
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
      const response = await fetch("/api/erp/fiscal/config", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": snapshot.tenantId, "If-Match": etag }, body: JSON.stringify(draft) })
      const value = await response.json()
      if (!response.ok) {
        if ([401, 403, 409, 412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw new Error(value.title || "Não foi possível confirmar a gravação")
      }
      const revision = response.headers.get("etag")
      if (!revision) { setBlocked(true); throw new Error("Gravação recebida sem revisão. Recarregue para conferir os dados") }
      setSnapshot(value); setDraft(value.data); setBaseline(JSON.stringify(value.data)); setEtag(revision); setNotice("Configuração fiscal salva no servidor. A transmissão é feita na nota fiscal.")
    } catch (reason) {
      if (reason instanceof TypeError) setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a gravação. Recarregue antes de repetir")
    } finally { pending.current = false; setSaving(false) }
  }

  return <div className="mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6"><div><p className="text-sm text-primary">Preferências / Fiscal</p><h1 className="mt-2 text-3xl font-semibold">Configurações fiscais</h1><p className="mt-2 text-muted-foreground">{company ? `${company.legalName} · ${company.taxId}` : "Preparação fiscal da empresa ativa"}</p></div><Link className={buttonVariants({ variant: "outline" })} href="/fiscal/monitor">Notas recebidas</Link></header>
    {loading && <p role="status">Carregando configuração fiscal…</p>}
    {snapshot && company && <form onSubmit={save} className="space-y-6">
      {missing.length > 0 && <section aria-labelledby="fiscal-missing-title" className="form-section space-y-3"><h2 id="fiscal-missing-title" className="text-lg font-semibold">Dados para preencher</h2><p className="text-sm text-muted-foreground">Complete estas informações em Preferências antes de salvar o perfil fiscal. A série deve ser escolhida por você.</p><ul className="list-disc space-y-1 pl-5 text-sm">{missing.map(field => <li key={String(field)}>{field}</li>)}</ul></section>}
      <section className="form-section space-y-4"><h2 className="text-lg font-semibold">Empresa e tributação</h2><p className="text-sm text-muted-foreground">UF, inscrição estadual e regime devem corresponder ao <Link className="text-primary underline" href="/preferencias/empresa/dados?secao=fiscal">cadastro da empresa</Link>.</p>
        <p className="text-sm">Regime tributário cadastrado: {regimeLabels[company.taxRegime] || "Não informado"}</p><Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href="/preferencias/empresa/dados?secao=fiscal">{regimeLabels[company.taxRegime] ? "Editar regime tributário" : "Preencher regime tributário"}</Link>
        <fieldset disabled={!snapshot.canEdit || saving || blocked} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">UF do emitente<Input value={draft.state} maxLength={2} required onChange={event => setDraft({ ...draft, state: event.target.value.toUpperCase() })} /><span className="text-xs text-muted-foreground">Cadastro atual: {company.state || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Inscrição estadual<Input value={draft.stateRegistration} inputMode="numeric" pattern="[0-9]{1,14}" required onChange={event => setDraft({ ...draft, stateRegistration: event.target.value })} /><span className="text-xs text-muted-foreground">Somente dígitos. Cadastro atual: {company.stateRegistration || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Código IBGE do município<Input value={draft.municipalityCode} inputMode="numeric" pattern="[0-9]{7}" maxLength={7} required onChange={event => setDraft({ ...draft, municipalityCode: event.target.value })} /><span className="text-xs text-muted-foreground">Município cadastrado: {company.city || "não informado"}</span></label>
          <label className="space-y-2 text-sm">Código de regime tributário<select aria-label="Código de regime tributário" className="h-10 w-full rounded-xl border bg-background px-3" required value={draft.crt} onChange={event => setDraft({ ...draft, crt: event.target.value === "" ? "" : Number(event.target.value) })}><option value="">Selecione o CRT</option><option value={1}>1 — Simples Nacional</option><option value={2}>2 — Simples Nacional com excesso de sublimite</option><option value={3}>3 — Regime normal</option><option value={4}>4 — Simples Nacional — MEI</option></select></label>
          <label className="space-y-2 text-sm">Série da NF-e<Input type="number" min={1} max={999} step={1} required placeholder="Informe a série" value={draft.series} onChange={event => setDraft({ ...draft, series: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          <label className="space-y-2 text-sm">Ambiente<Input readOnly value="Homologação" /><span className="text-xs text-muted-foreground">Salvar a preparação não autoriza transmissão ou consumo de numeração.</span></label>
        </fieldset>
      </section>
      <section className="form-section space-y-4"><h2 className="text-lg font-semibold">Certificado digital A1</h2><p className="text-sm">Situação: {snapshot.certificateVerified ? "Certificado conectado e vigente" : "Nenhum certificado vigente disponível"}.</p><p className="text-sm text-muted-foreground">O arquivo e a senha são informados na tela própria do certificado, que confere o CNPJ, a validade e a cadeia de confiança.</p><Link className={buttonVariants({ variant: "outline" })} href="/preferencias/certificado-digital">Gerenciar certificado A1</Link></section>
      {!snapshot.canEdit && <p className="text-sm">Seu acesso permite apenas consultar a configuração fiscal.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!snapshot.canEdit || saving || blocked || !dirty || missing.length > 0}>{saving ? "Salvando…" : "Salvar configuração fiscal"}</Button>{dirty && <span className="text-sm text-muted-foreground">Alterações ainda não salvas</span>}</div>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error} Sua edição foi preservada.</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {(blocked || !snapshot && !loading) && <Button variant="outline" onClick={() => { if (!dirty || window.confirm("Descartar a edição e carregar os dados atuais do servidor?")) { setLoading(true); setNotice(""); setReload(value => value + 1) } }}>Recarregar dados do servidor</Button>}
  </div>
}
