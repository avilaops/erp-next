import { erpFetch } from "@/lib/api/client"
import { parseCteLinks, parseCteOptions } from "./cte-links-model"
import type { CteAccess, CteInspectionView } from "./cte-inspection-model"
import type { CteLinkInput, CteLinkKind } from "./cte-links-model"

export type VerifyCteAccess = (signal: AbortSignal) => Promise<CteAccess>
type CommandContext = { tenantId: string; subject: string; documentId: string; hash: string; revision: number; key: string; body: string; kind: CteLinkKind }
export type CteLinkCommand = Readonly<CommandContext & (
  { action: "link"; input: Readonly<CteLinkInput> } | { action: "unlink"; linkId: string }
)>

export class CteLinkFailure extends Error {
  constructor(message: string, public status = 0, public contextInvalid = false) { super(message); this.name = "CteLinkFailure" }
}
const problem = (value: unknown) => value && typeof value === "object" && "title" in value && typeof value.title === "string" && value.title.trim() && value.title.length <= 300 ? value.title : "Não foi possível confirmar os vínculos CT-e. Atualize a consulta"

async function access(verify: VerifyCteAccess, signal: AbortSignal, inspected: CteInspectionView, expected?: CteAccess, kind?: CteLinkKind, write = false) {
  let current: CteAccess
  try { current = await verify(signal) } catch (error) { throw new CteLinkFailure(error instanceof Error ? error.message : "Confirme o acesso atual antes de continuar", 0, true) }
  signal.throwIfAborted()
  const required = ["fiscal.cte.read", ...(kind ? ["catalog.parties.read", kind === "purchase" ? "purchasing.orders.read" : "sales.orders.read"] : []), ...(write ? ["fiscal.cte.link"] : [])]
  if (current.id !== inspected.tenantId || expected && current.subject !== expected.subject || !required.every(p => current.permissions.includes(p))) throw new CteLinkFailure("O acesso atual aos vínculos mudou. Atualize os arquivos antes de continuar", 403, true)
  return current
}

async function request(inspected: CteInspectionView, verify: VerifyCteAccess, signal: AbortSignal, suffix: string, options: { kind?: CteLinkKind; command?: CteLinkCommand } = {}) {
  const command = options.command
  const before = await access(verify, signal, inspected, undefined, options.kind, !!command)
  if (command && (command.tenantId !== before.id || command.subject !== before.subject || command.documentId !== inspected.documentId || command.hash !== inspected.sourceXmlSha256)) throw new CteLinkFailure("A empresa ou o usuário do comando mudou. Atualize os arquivos", 409, true)
  let response: Response | undefined, value: unknown, transportError: unknown
  try {
    response = await erpFetch(`/api/erp/fiscal/cte-distribution/documents/${inspected.documentId}/${suffix}`, {
      method: command ? "POST" : "GET",
      headers: { "X-Tenant-Id": before.id, ...(command ? { "Content-Type": "application/json", "Idempotency-Key": command.key, "If-Match": `"${command.revision}"` } : {}) },
      ...(command ? { body: command.body } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    })
    value = await response.json()
  } catch (error) { transportError = error }
  const after = await access(verify, signal, inspected, before, options.kind, !!command)
  if (transportError || !response) throw new CteLinkFailure("Resultado dos vínculos não confirmado. Atualize a consulta ou repita a confirmação", 503)
  if (!response.ok) throw new CteLinkFailure(problem(value), response.status, response.status === 401 || response.status === 403)
  return { value, current: after }
}

export async function readCteLinks(inspected: CteInspectionView, verify: VerifyCteAccess, signal: AbortSignal) {
  const { value, current } = await request(inspected, verify, signal, "commercial-links")
  try { return parseCteLinks(value, inspected, current.permissions) } catch (error) { throw new CteLinkFailure(error instanceof Error ? error.message : "Resposta de vínculos inválida", 502, true) }
}
export async function readCteOptions(inspected: CteInspectionView, verify: VerifyCteAccess, signal: AbortSignal, kind: CteLinkKind, offset: number) {
  const params = new URLSearchParams({ kind, offset: String(offset), limit: "25" })
  const { value } = await request(inspected, verify, signal, `commercial-options?${params}`, { kind })
  try { return parseCteOptions(value, inspected, kind, offset) } catch (error) { throw new CteLinkFailure(error instanceof Error ? error.message : "Pedidos inválidos para conferência", 502, true) }
}
export async function sendCteLinkCommand(inspected: CteInspectionView, verify: VerifyCteAccess, signal: AbortSignal, command: CteLinkCommand) {
  const suffix = command.action === "link" ? "commercial-links" : `commercial-links/${command.linkId}/unlink`
  const { value, current } = await request(inspected, verify, signal, suffix, { kind: command.kind, command })
  try { return parseCteLinks(value, inspected, current.permissions) } catch (error) { throw new CteLinkFailure(error instanceof Error ? error.message : "Resposta dos vínculos inválida", 502, true) }
}
