import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"

type Fetcher = (resource: string, init: RequestInit) => Promise<Response>
const lookupMessage = "Consulta indisponível no momento. Tente novamente ou preencha os dados manualmente; seus campos foram preservados"
const sessionMessage = "Não foi possível conferir a empresa da sessão. Tente novamente; seus campos foram preservados"
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === "string"

function lookupReply(value: unknown): value is Schema<"LookupReply"> {
  if (!object(value) || typeof value.tenantId !== "string" || !value.tenantId || typeof value.value !== "string"
    || !["cnpj", "cep", "ie"].includes(String(value.kind)) || !["found", "not_found", "unavailable", "unsupported"].includes(String(value.status))
    || !Array.isArray(value.warnings) || !value.warnings.every(warning => typeof warning === "string")
    || !optionalString(value.source) || !optionalString(value.sourceUpdatedAt) || !optionalString(value.expiresAt)
    || typeof value.fetchedAt !== "string" || typeof value.cached !== "boolean"
    || !Array.isArray(value.attempts) || !value.attempts.every(attempt => object(attempt) && typeof attempt.source === "string" && typeof attempt.outcome === "string")) return false
  return value.status === "found"
    ? object(value.data) && object(value.data.fields) && Object.values(value.data.fields).every(field => typeof field === "string")
      && typeof value.data.genericPostalCode === "boolean" && typeof value.data.taxpayerStatus === "string"
      && Array.isArray(value.data.stateRegistrations) && value.data.stateRegistrations.every(registration => object(registration)
        && typeof registration.state === "string" && typeof registration.number === "string"
        && (registration.active === undefined || registration.active === null || typeof registration.active === "boolean")
        && optionalString(registration.sourceUpdatedAt))
    : value.data === null
}

function sessionReply(value: unknown): value is Schema<"CurrentAccessResponse"> {
  return object(value) && object(value.tenant) && typeof value.tenant.id === "string" && Boolean(value.tenant.id.trim())
}

// These endpoints only read registry/session data. Business commands must never use this retry.
async function readRegistry<T>(resource: string, init: RequestInit, valid: (value: unknown) => value is T, message: string, fetcher: Fetcher): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    init.signal?.throwIfAborted()
    let response: Response
    try { response = await fetcher(resource, init) }
    catch {
      init.signal?.throwIfAborted()
      if (attempt === 0) continue
      throw new Error(message)
    }
    init.signal?.throwIfAborted()
    let data: unknown
    try { data = await response.json() } catch { data = null }
    init.signal?.throwIfAborted()
    if (response.ok && valid(data)) return data
    const retryable = response.ok || [502, 503, 504].includes(response.status)
    if (retryable && attempt === 0) continue
    const title = object(data) && typeof data.title === "string" ? data.title.trim() : ""
    if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente; seus campos foram preservados")
    if (response.status === 403) throw new Error("A consulta não foi autorizada para seu acesso; seus campos foram preservados")
    if (response.status === 409) throw new Error("A empresa da sessão mudou. Recarregue antes de consultar; seus campos foram preservados")
    throw new Error(!response.ok && title && title.length <= 300 && !/[<>]|JSON|SyntaxError|Unexpected/i.test(title) ? title : message)
  }
  throw new Error(message)
}

export function requestRegistryLookup(input: Schema<"LookupInput">, tenantId: string, signal: AbortSignal, fetcher: Fetcher = erpFetch) {
  return readRegistry("/api/erp/registry-lookups", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId }, body: JSON.stringify(input), signal,
  }, lookupReply, lookupMessage, fetcher)
}

export function requestRegistrySession(signal: AbortSignal, fetcher: Fetcher = erpFetch) {
  return readRegistry("/api/erp/me", { signal }, sessionReply, sessionMessage, fetcher)
}
