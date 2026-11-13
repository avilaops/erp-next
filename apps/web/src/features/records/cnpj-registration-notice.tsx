"use client"

import { cnpjRegistration } from "./cnpj-registration-model"

export function CnpjRegistrationNotice({ fields, value, source, fetchedAt }: { fields?: Record<string, string>; value: string; source?: string | null; fetchedAt?: string }) {
  if (!fields) return null
  const registration = cnpjRegistration(fields)
  const document = value.replace(/[.\s/-]/g, "").toUpperCase()
  const formatted = document.length === 14 ? document.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, "$1.$2.$3/$4-$5") : value
  return <div role={registration.requiresAttention ? "alert" : "status"} aria-label="Situação cadastral do CNPJ" className={`min-w-0 space-y-2 rounded-lg border p-3 ${registration.requiresAttention ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/20"}`}>
    <p className={`text-sm font-semibold ${registration.requiresAttention ? "text-destructive" : "text-foreground"}`}>Situação cadastral do CNPJ: {registration.label}</p>
    {registration.requiresAttention && <p className="text-sm">Este CNPJ está {registration.label.toLowerCase()} na fonte consultada. Confira essa informação antes de continuar o cadastro.</p>}
    {!registration.known && <p className="text-sm">A fonte não confirmou a situação cadastral deste CNPJ.</p>}
    <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">CNPJ consultado</dt><dd className="break-words">{formatted}</dd></div>{registration.date && <div><dt className="text-muted-foreground">Data da situação cadastral</dt><dd>{registration.date}</dd></div>}{registration.reason && <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Motivo informado</dt><dd className="break-words">{registration.reason}</dd></div>}</dl>
    {source && <p className="break-words text-xs text-muted-foreground">Fonte: {source}{fetchedAt && Number.isFinite(Date.parse(fetchedAt)) ? ` · Consultado em ${new Date(fetchedAt).toLocaleString("pt-BR")}` : ""}</p>}
  </div>
}
