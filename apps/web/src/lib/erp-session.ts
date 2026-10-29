import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"

export type ErpSession = { accessToken: string; tenantId: string; expiresAt: number }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function erpConfiguration() {
  const origin = new URL(process.env.ERP_WEB_ORIGIN || "http://localhost:3000")
  const issuer = new URL(process.env.AUTH_ISSUER || "https://auth.avilaops.com")
  const api = new URL(process.env.ERP_API_URL || "http://127.0.0.1:8080")
  for (const url of [origin, issuer, api]) {
    if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Endereço de serviço inválido")
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) throw new Error("ERP_WEB_ORIGIN deve conter apenas a origem")
  const secret = process.env.ERP_SESSION_SECRET || ""
  if (Buffer.byteLength(secret) < 32) throw new Error("ERP_SESSION_SECRET deve ter ao menos 32 bytes")
  return { origin: origin.origin, issuer: issuer.origin, api: api.origin, secret, secure: origin.protocol === "https:", clientId: process.env.ERP_AUTH_CLIENT_ID, clientSecret: process.env.ERP_AUTH_CLIENT_SECRET }
}

export function seal(value: object, purpose: string): string {
  const key = createHash("sha256").update(erpConfiguration().secret).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(purpose))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
}

export function unseal<T>(value: string, purpose: string): T | null {
  try {
    const bytes = Buffer.from(value, "base64url")
    if (bytes.length < 29 || bytes.length > 3072) return null
    const key = createHash("sha256").update(erpConfiguration().secret).digest()
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(purpose))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T
  } catch { return null }
}

export function cookieName(purpose: "session" | "auth") {
  return `${erpConfiguration().secure ? "__Host-" : ""}erp_${purpose}`
}

export const cookieOptions = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: erpConfiguration().secure, path: "/", maxAge })

export type IdentitySession = { accessToken: string; tenantId: string | null; expiresAt: number }

export function identityFromCookie(value: string): IdentitySession | null {
  const session = unseal<IdentitySession>(value, "erp-session")
  if (!session || typeof session.accessToken !== "string" || !session.accessToken || (session.tenantId !== null && (typeof session.tenantId !== "string" || !uuidPattern.test(session.tenantId))) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null
  return session
}

export async function currentIdentitySession(): Promise<IdentitySession | null> {
  const jar = await cookies()
  return identityFromCookie(jar.get(cookieName("session"))?.value || "")
}

export async function currentSession(): Promise<ErpSession | null> {
  const session = await currentIdentitySession()
  return session?.tenantId ? { ...session, tenantId: session.tenantId } : null
}

export async function authEndpoints() {
  const config = erpConfiguration()
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error("Auth indisponível")
  const metadata = await response.json()
  if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported?.includes("S256")) throw new Error("Contrato do Auth incompatível")
  for (const field of ["authorization_endpoint", "token_endpoint"]) {
    if (typeof metadata[field] !== "string" || new URL(metadata[field]).origin !== config.issuer) throw new Error("Endpoint do Auth inválido")
  }
  return { authorization: metadata.authorization_endpoint as string, token: metadata.token_endpoint as string }
}
