"use client"

import { erpFetch } from "@/lib/api/client"

import type { Schema } from "@/lib/api/types"

import { useRef, useState } from "react"
import { useTheme } from "@/components/shell/theme-provider"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { AccessLink } from "@/components/feedback/session-recovery"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { useResource } from "@/hooks/use-operation"

export type PersonalPreferences = Schema<"PreferencesSnapshot">

export function SystemPreferences() {
  const [theme, setTheme] = useTheme()
  const resource = useResource<PersonalPreferences>("/api/erp/preferences")
  const [draft, setDraft] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const pending = useRef(false)
  const size = draft ?? resource.value?.data.productPageSize ?? 25
  const dirty = !!resource.value && size !== resource.value.data.productPageSize
  useNavigationGuard(dirty ? "Sair e descartar as preferências não salvas?" : null)

  async function save() {
    if (!resource.value || !resource.etag || !dirty || blocked || pending.current) return
    pending.current = true; setBusy(true); setError(""); setMessage("")
    try {
      const response = await erpFetch("/api/erp/preferences", { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": resource.value.tenantId, "If-Match": resource.etag }, body: JSON.stringify({ productPageSize: size, ownerKey: resource.value.ownerKey }) })
      const result = await response.json()
      if (!response.ok) {
        if ([401,403,409,412].includes(response.status) || response.status >= 500) setBlocked(true)
        throw new Error(result.title || "Não foi possível confirmar as preferências")
      }
      if (result.tenantId !== resource.value.tenantId || result.data?.productPageSize !== size || !response.headers.get("etag")) { setBlocked(true); throw new Error("Confirmação incompleta. Recarregue para conferir a revisão antes de salvar novamente.") }
      setDraft(null); setMessage("Preferência salva no servidor para sua conta nesta empresa."); resource.reload()
    } catch (reason) {
      setBlocked(true)
      setError(reason instanceof Error ? reason.message : "Falha de gravação. Recarregue para conferir.")
    } finally { pending.current = false; setBusy(false) }
  }

  function reload() {
    if (dirty && !window.confirm("Recarregar e descartar sua alteração de preferência?")) return
    setDraft(null); setBlocked(false); setError(""); setMessage(""); resource.reload()
  }

  return <div className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 lg:px-6">
    <PageHeader eyebrow="Preferências / Sistema" title="Preferências do sistema" description="Aparência deste navegador e opções pessoais da sua conta na empresa ativa." />
    <section className="form-section space-y-4" aria-labelledby="theme-title">
      <h2 id="theme-title" className="text-lg font-semibold">Aparência</h2>
      <p className="text-sm text-muted-foreground">O tema é aplicado imediatamente e salvo somente neste navegador.</p>
      <fieldset><legend className="sr-only">Tema</legend><div className="grid gap-3 sm:grid-cols-3">
        {(["light", "dark", "system"] as const).map(value => <label className="flex min-h-11 items-center gap-3 rounded-xl border p-4 has-[:checked]:border-primary" key={value}>
          <input type="radio" name="theme" checked={theme === value} onChange={() => setTheme(value)} />{value === "light" ? "Claro" : value === "dark" ? "Escuro" : "Sistema"}
        </label>)}
      </div></fieldset>
    </section>
    <section className="form-section space-y-4" aria-labelledby="listing-title">
      <h2 id="listing-title" className="text-lg font-semibold">Catálogo de produtos</h2>
      <p className="text-sm text-muted-foreground">Quantidade de produtos por página, salva no servidor para sua conta nesta empresa. Não altera a listagem de outras pessoas ou empresas.</p>
      {resource.loading && <p role="status">Carregando preferências…</p>}
      {resource.error && <div role="alert" className="space-y-3"><p>{resource.error}</p>{resource.status === 401 ? <AccessLink /> : <Button variant="outline" onClick={reload}>Tentar novamente</Button>}</div>}
      {resource.value && <>
        <label className="grid max-w-sm gap-2 text-sm font-medium">Produtos por página<select className="min-h-11 rounded-lg border bg-background px-3" value={size} disabled={busy || resource.loading || blocked} onChange={event => { setDraft(Number(event.target.value)); setMessage("") }}>
          {[10,25,50,100].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <div className="flex flex-wrap gap-3"><Button onClick={save} disabled={!dirty || busy || blocked || resource.loading}>Salvar preferências</Button><Button variant="outline" disabled={busy || resource.loading} onClick={reload}>Recarregar preferências</Button></div>
      </>}
      {error && <p role="alert">{error} Sua escolha foi preservada.</p>}
      {message && <p role="status">{message}</p>}
      {blocked && <p className="text-sm">Recarregue as preferências para conferir a gravação antes de tentar novamente.</p>}
    </section>
    <section className="form-section space-y-3"><h2 className="text-lg font-semibold">Idioma, formatos e notificações</h2><p className="text-sm text-muted-foreground">A escolha de idioma, formatos de data e número, fuso horário e notificações ainda não está disponível. Não há configuração ou envio desses avisos por esta tela.</p></section>
  </div>
}
