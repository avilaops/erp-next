"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useNavigationGuard } from "@/components/navigation-guard"
import type { CompanyData } from "./company-types"

export function CompanyPartnerForm({ initial, canEdit, saving, conflict, onSave }: { initial: CompanyData; canEdit: boolean; saving: boolean; conflict: boolean; onSave: (data: CompanyData) => Promise<boolean> }) {
  const [dirty, setDirty] = useState(false)
  useNavigationGuard(dirty ? "Sair e descartar as alterações não salvas do sócio?" : null)
  return <form className="form-section max-w-3xl" onChange={() => setDirty(true)} onReset={() => setDirty(false)} onSubmit={async event => {
    event.preventDefault()
    if (!canEdit || saving || conflict) return
    const form = new FormData(event.currentTarget)
    if (await onSave({ ...initial, partnerName: String(form.get("partnerName") || "").trim(), partnerMobile: String(form.get("partnerMobile") || "").trim() })) setDirty(false)
  }}>
    <h2 className="text-xl font-semibold">Dados do sócio(a)</h2>
    <p className="mb-6 mt-2 text-sm text-muted-foreground">Contato do sócio responsável pela empresa. Estes dados são independentes do seu usuário de acesso.</p>
    <fieldset disabled={!canEdit || saving} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field">Nome completo<input name="partnerName" defaultValue={initial.partnerName || ""} maxLength={100} autoComplete="off" /></label>
        <label className="field">Celular do sócio<input name="partnerMobile" defaultValue={initial.partnerMobile || ""} maxLength={30} type="tel" autoComplete="off" /></label>
      </div>
      <div className="flex flex-wrap justify-end gap-3"><Button type="reset" variant="outline">Cancelar</Button><Button type="submit" disabled={!dirty || conflict}>{saving ? "Salvando…" : "Salvar dados do sócio"}</Button></div>
    </fieldset>
  </form>
}
