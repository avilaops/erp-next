"use client"

import { useId, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RequestError } from "@/components/feedback/session-recovery"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"

type Snapshot = Schema<"MailSettingsSnapshot">
type Data = Snapshot["data"]
const endpoint = "/api/erp/platform/mail-settings"
const sourceLabels = { platform: "Preferências da plataforma", environment: "Configuração do servidor", unconfigured: "Ainda não configurado" }

export function MailSettings() {
  const resource = useResource<Snapshot>(endpoint)
  const [draft, setDraft] = useState<Data | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const passwordHintId = useId()
  const value = resource.value
  const data = draft || value?.data
  const dirty = !!value && !!data && (password.length > 0 || JSON.stringify(data) !== JSON.stringify(value.data))
  const changedDestination = !!value && !!data && ["host", "port", "security", "username"].some(key => data[key as keyof Data] !== value.data[key as keyof Data])
  const needsPassword = !!data?.enabled && (value?.source !== "platform" || !value.data.passwordSet || changedDestination)
  const frozen = busy || blocked || resource.loading || !value?.canManage
  useNavigationGuard(dirty ? "Sair e descartar a configuração de e-mail não salva?" : null)

  function update<K extends keyof Data>(key: K, next: Data[K]) {
    if (!data) return
    setDraft({ ...data, [key]: next }); setMessage("")
  }
  function reload() {
    if (dirty && !window.confirm("Recarregar e descartar os campos SMTP não salvos?")) return
    setDraft(null); setPassword(""); setBlocked(false); setError(""); setMessage(""); resource.reload()
  }
  async function save() {
    if (!value || !data || !resource.etag || !dirty || frozen || pending.current) return
    pending.current = true; setBusy(true); setError(""); setMessage("")
    const input = { enabled: data.enabled, name: data.name.trim(), host: data.host.trim().toLowerCase(), port: data.port, security: data.security, username: data.username.trim(), fromName: data.fromName.trim(), fromAddress: data.fromAddress.trim(), ...(password ? { password } : {}) }
    try {
      const response = await erpFetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": resource.etag }, body: JSON.stringify(input) })
      const result = await response.json() as Snapshot & { title?: string }
      if (!response.ok) {
        if ([401, 403, 409, 412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw new Error(result.title || "Não foi possível confirmar a configuração SMTP.")
      }
      if (result.source !== "platform" || result.revision !== value.revision + 1 || response.headers.get("etag") !== `"${result.revision}"` || result.data.host !== input.host || result.data.enabled !== input.enabled) {
        setBlocked(true); throw new Error("Confirmação incompleta. Recarregue a configuração para conferir o resultado.")
      }
      setDraft(null); setPassword(""); setMessage("Configuração SMTP salva."); resource.reload()
    } catch (reason) {
      setBlocked(true); setError(reason instanceof Error ? reason.message : "Não foi possível confirmar o salvamento. Recarregue para conferir o resultado.")
    } finally { pending.current = false; setBusy(false) }
  }
  return <div className="mx-auto max-w-4xl space-y-6 px-4 pb-20 pt-8 lg:px-6">
    <PageHeader breadcrumbs={[{ label: "Preferências", href: "/preferencias" }, { label: "Sistema", href: "/preferencias/sistema" }, { label: "E-mail" }]} title="E-mail da plataforma" description="Servidor SMTP compartilhado pelos envios de pedidos, propostas e documentos de todas as empresas." />
    {resource.loading && !value && <p role="status">Carregando configuração de e-mail…</p>}
    {resource.error && <div className="space-y-3"><p role="alert"><RequestError status={resource.status} message={resource.error} /></p><Button variant="outline" onClick={reload}>Consultar novamente</Button></div>}
    {value && data && <form className="form-section space-y-5" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="space-y-1"><h2 className="font-semibold">Servidor de envio</h2><p className="text-sm text-muted-foreground">Origem atual: {sourceLabels[value.source]}. Esta configuração é administrada pela plataforma.</p></div>
      {!value.encryptionReady && <p role="status">A proteção de credenciais do servidor precisa estar disponível para ativar o envio.</p>}
      <fieldset disabled={frozen} className="space-y-5">
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={data.enabled} onChange={event => update("enabled", event.target.checked)} />Ativar envio de e-mail</label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">Nome do servidor<Input className="min-h-11 text-base sm:text-sm" maxLength={120} placeholder="Ex.: Correio da plataforma" value={data.name} onChange={event => update("name", event.target.value)} /></label>
          <label className="grid min-w-0 gap-1 text-sm">Servidor SMTP<Input className="min-h-11 text-base sm:text-sm" required={data.enabled} maxLength={253} autoComplete="off" placeholder="smtp.exemplo.com.br" value={data.host} onChange={event => update("host", event.target.value)} /></label>
          <label className="grid min-w-0 gap-1 text-sm">Porta<Input className="min-h-11 text-base sm:text-sm" type="number" inputMode="numeric" min={1} max={65535} required value={data.port} onChange={event => update("port", event.target.value === "" ? 0 : Number(event.target.value))} /></label>
          <label className="grid min-w-0 gap-1 text-sm">Segurança<select className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-base sm:text-sm" value={data.security} onChange={event => update("security", event.target.value as Data["security"])}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select><span className="text-xs text-muted-foreground">Portas usuais: 587 para STARTTLS; 465 para TLS.</span></label>
          <label className="grid min-w-0 gap-1 text-sm">Usuário SMTP<Input className="min-h-11 text-base sm:text-sm" required={data.enabled} maxLength={320} autoComplete="off" value={data.username} onChange={event => update("username", event.target.value)} /></label>
          <div className="grid min-w-0 gap-1 text-sm sm:col-span-2"><label htmlFor={`${passwordHintId}-input`}>Senha SMTP</label><Input id={`${passwordHintId}-input`} className="min-h-11 text-base sm:text-sm" type="password" autoComplete="new-password" required={needsPassword} maxLength={4096} value={password} aria-describedby={passwordHintId} onChange={event => { setPassword(event.target.value); setMessage("") }} /><p id={passwordHintId} className="text-xs text-muted-foreground">{value.source === "environment" ? "Informe a senha ao salvar a configuração do servidor pela primeira vez." : changedDestination && data.enabled ? "Servidor ou autenticação alterados. Informe a senha para confirmar este destino." : data.passwordSet ? "Senha cadastrada. Deixe em branco para manter a senha atual." : "Informe a senha fornecida pelo serviço de e-mail."}</p></div>
        </div>
        <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm">Nome do remetente<Input className="min-h-11 text-base sm:text-sm" maxLength={160} value={data.fromName} onChange={event => update("fromName", event.target.value)} /></label>
          <label className="grid min-w-0 gap-1 text-sm">E-mail do remetente<Input className="min-h-11 text-base sm:text-sm" type="email" autoComplete="off" required={data.enabled} maxLength={254} value={data.fromAddress} onChange={event => update("fromAddress", event.target.value)} /></label>
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Os próximos envios usarão este servidor e remetente. Cada envio de documento continua sendo solicitado na sua própria tela.</p>
      {error && <p role="alert">{error} Os campos foram preservados.</p>}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!dirty || frozen || !resource.etag || data.enabled && !value.encryptionReady}>{busy ? "Salvando SMTP…" : "Salvar SMTP"}</Button><Button type="button" variant="outline" disabled={busy || resource.loading} onClick={reload}>Recarregar configuração</Button></div>
      {blocked && <p className="text-sm">Recarregue a configuração para conferir a revisão antes de tentar salvar novamente.</p>}
    </form>}
  </div>
}
