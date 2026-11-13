"use client"

import { useEffect, useState } from "react"
import type { Schema } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { validCnpj } from "./automatic-cnpj"
import { requestRegistryLookup, requestRegistrySession } from "./registry-request"
import { CnpjRegistrationNotice } from "./cnpj-registration-notice"

export function CnpjRegistrationCheck({ value, tenantId }: { value: string; tenantId: string }) {
  const document = value.trim().replace(/[.\s/-]/g, "").toUpperCase()
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify([tenantId, document, retry])
  const [result, setResult] = useState<{ key: string; reply?: Schema<"LookupReply">; error?: string } | null>(null)
  useEffect(() => {
    if (!validCnpj(document)) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    void (async () => {
      try {
        const reply = await requestRegistryLookup({ kind: "cnpj", context: "party", value: document }, tenantId, signal)
        if (reply.tenantId !== tenantId || reply.kind !== "cnpj" || reply.value !== document || reply.status !== "found" || !reply.data || !reply.source || !(Date.parse(reply.expiresAt || "") > Date.now())) throw Error("Consulta não confirmada")
        const session = await requestRegistrySession(signal)
        if (session.tenant.id !== tenantId) throw Error("A empresa da sessão mudou")
        if (!signal.aborted) setResult({ key, reply })
      } catch {
        if (!controller.signal.aborted) setResult({ key, error: "Não foi possível conferir a situação cadastral do CNPJ. Os dados salvos foram preservados." })
      }
    })()
    return () => controller.abort()
  }, [document, tenantId, key])
  if (!validCnpj(document)) return null
  const current = result?.key === key ? result : null
  return <section aria-label="Consulta da situação cadastral" className="min-w-0 space-y-2">
    {current?.reply ? <CnpjRegistrationNotice fields={{ registrationStatusCode: "unknown", registrationStatus: "Não confirmada", ...current.reply.data!.fields }} value={document} source={current.reply.source} fetchedAt={current.reply.fetchedAt} /> : <p role="status" className="text-xs text-muted-foreground">{current?.error || "Conferindo a situação cadastral do CNPJ…"}</p>}
    {current && <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>Conferir situação cadastral</Button>}
  </section>
}
