"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { CnpjRegistrationNotice } from "./cnpj-registration-notice"

type RegistryData = Schema<"RegistryData">
type LookupResult = Pick<Schema<"LookupReply">, "value" | "status" | "data" | "source" | "sourceUpdatedAt" | "expiresAt" | "fetchedAt" | "warnings"> & { tenantId?: string }
const normalize = (value: string) => value.trim().replace(/[.\s/-]/g, "").toUpperCase()

export function validCnpj(value: string) {
  if (!/^[A-Z\d]{12}\d{2}$/.test(value) || /^(.)\1+$/.test(value)) return false
  const digit = (base: string) => {
    let weight = base.length - 7
    const sum = [...base].reduce((total, character) => {
      const result = total + (character.charCodeAt(0) - 48) * weight
      weight = weight === 2 ? 9 : weight - 1
      return result
    }, 0)
    const remainder = sum % 11
    return String(remainder < 2 ? 0 : 11 - remainder)
  }
  return digit(value.slice(0, 12)) === value[12] && digit(value.slice(0, 13)) === value[13]
}

const companyFields = ["legalName", "tradeName", "personType", "postalCode", "state", "city", "street", "district", "number", "complement", "cnae", "activityDescription", "companySize", "taxRegime", "email", "phone"]

export function fillCompanyFields(form: HTMLFormElement, data: RegistryData) {
  let count = 0
  const fill = (name: string, value?: string) => {
    const input = form.elements.namedItem(name)
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || input.matches(":disabled") || input.value.trim() || !value?.trim()) return
    if (input instanceof HTMLSelectElement && !Array.from(input.options).some(option => option.value === value)) return
    input.value = value
    count++
  }
  for (const field of companyFields) fill(field, data.fields[field])
  const state = form.elements.namedItem("state")
  if (state instanceof HTMLSelectElement) {
    const active = [...new Set(data.stateRegistrations.filter(item => item.state === state.value && item.active === true).map(item => item.number))]
    if (active.length === 1) fill("stateRegistration", active[0])
  }
  return count
}

export function AutomaticCnpj({ formRef, tenantId, disabled, onApply }: {
  formRef: RefObject<HTMLFormElement | null>; tenantId?: string; disabled: boolean;
  onApply: (data: RegistryData) => number;
}) {
  const apply = useRef(onApply)
  const document = useRef("")
  const generated = useRef(new Map<HTMLInputElement | HTMLSelectElement, string>())
  useEffect(() => { apply.current = onApply })
  const [message, setMessage] = useState("")
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  const [registration, setRegistration] = useState<{ reply: LookupResult; tenantId?: string } | null>(null)

  useEffect(() => {
    const form = formRef.current
    if (!form || disabled) return
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = ""
    const filled = generated.current
    const currentValue = () => {
      const document = form.elements.namedItem("taxId")
      const person = form.elements.namedItem("personType")
      if (!(document instanceof HTMLInputElement) || person instanceof HTMLSelectElement && person.value !== "juridica") return ""
      return normalize(document.value)
    }
    const schedule = (event?: Event) => {
      if (event) {
        if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return
        if (!["taxId", "personType"].includes(event.target.name)) { filled.delete(event.target); return }
      }
      const value = currentValue()
      if (last === value && value) return
      clearTimeout(timer)
      controller?.abort()
      if (document.current !== value) {
        setRegistration(null)
        for (const [input, previous] of filled) if (input.value === previous) input.value = ""
        filled.clear()
        document.current = value
      }
      if (!validCnpj(value)) { last = ""; setMessage(""); setFailed(false); return }
      timer = setTimeout(async () => {
        controller = new AbortController()
        const request = controller
        last = value
        setFailed(false); setRegistration(null); setMessage("Consultando os dados do CNPJ…")
        const isCurrent = () => !request.signal.aborted && currentValue() === value
        try {
          const response = await erpFetch(tenantId ? "/api/erp/registry-lookups" : "/api/erp/company-registration/lookup", {
            method: "POST", headers: { "Content-Type": "application/json", ...(tenantId ? { "X-Tenant-Id": tenantId } : {}) },
            body: JSON.stringify(tenantId ? { kind: "cnpj", context: "company", value } : { value }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
          })
          const reply: LookupResult & { title?: string } = await response.json()
          if (!isCurrent()) return
          if (!response.ok) throw new Error(reply.title || "Consulta indisponível. Continue manualmente.")
          if (normalize(reply.value || "") !== value || tenantId && reply.tenantId !== tenantId) throw new Error("A consulta não corresponde ao cadastro atual. Seus campos foram preservados.")
          if (reply.status !== "found" || !reply.data) throw new Error(reply.warnings?.join(" ") || "CNPJ sem dados disponíveis. Continue manualmente.")
          if (!reply.source || !reply.expiresAt || !(Date.parse(reply.expiresAt) > Date.now())) throw new Error("Consulta sem origem ou validade. Continue manualmente.")
          if (tenantId) {
            const access = await erpFetch("/api/erp/me", { signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) })
            const session: Schema<"CurrentAccessResponse"> = await access.json()
            if (!access.ok || session.tenant?.id !== tenantId) throw new Error("A empresa da sessão mudou. Recarregue; seus campos foram preservados.")
          }
          if (!isCurrent()) return
          setRegistration({ reply, tenantId })
          const inputs = Array.from(form.elements).filter((input): input is HTMLInputElement | HTMLSelectElement => input instanceof HTMLInputElement || input instanceof HTMLSelectElement)
          const before = new Map(inputs.map(input => [input, input.value]))
          const count = apply.current(reply.data)
          for (const input of inputs) if (input.value !== before.get(input)) filled.set(input, input.value)
          const updated = reply.sourceUpdatedAt && Number.isFinite(Date.parse(reply.sourceUpdatedAt)) ? ` · Atualização: ${new Date(reply.sourceUpdatedAt).toLocaleDateString("pt-BR")}` : ""
          setMessage(`${count ? "Dados disponíveis preenchidos. Revise antes de salvar." : "Consulta concluída. Seus dados já preenchidos foram preservados."} Fonte: ${reply.source}${updated}`)
        } catch (error) {
          if (isCurrent()) { setFailed(true); setMessage(error instanceof Error ? error.message : "Consulta indisponível. Continue manualmente.") }
        }
      }, 600)
    }
    form.addEventListener("input", schedule)
    form.addEventListener("change", schedule)
    schedule()
    return () => { clearTimeout(timer); controller?.abort(); form.removeEventListener("input", schedule); form.removeEventListener("change", schedule) }
  }, [disabled, formRef, tenantId, retry])

  return <div className="col-span-full min-w-0 space-y-2">
    {registration && registration.tenantId === tenantId && !disabled && <CnpjRegistrationNotice fields={registration.reply.data?.fields} value={registration.reply.value} source={registration.reply.source} fetchedAt={registration.reply.fetchedAt} />}
    <p role="status" aria-live="polite" className="break-words text-sm text-muted-foreground">{message || "Ao informar um CNPJ válido, os dados disponíveis preencherão os campos vazios."}</p>
    {failed && <Button type="button" variant="outline" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Tentar consulta novamente</Button>}
  </div>
}
