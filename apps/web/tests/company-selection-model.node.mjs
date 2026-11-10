import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

const tenant = "11111111-1111-4111-8111-111111111111"
const otherTenant = "22222222-2222-4222-8222-222222222222"
const compile = source => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")
const returnTo = compile(readFileSync(new URL("../src/lib/return-to.ts", import.meta.url), "utf8"))
const clientSource = readFileSync(new URL("../src/features/company/company-selection.ts", import.meta.url), "utf8").replace('"@/lib/return-to"', JSON.stringify(returnTo))

for (const [environment, minimumBudget] of [["development", 60000], ["production", 15000]]) test(`selection allows the server and ${environment} startup to finish, then replaces tenant client state`, async () => {
  const client = await import(compile(clientSource.replaceAll("process.env.NODE_ENV", JSON.stringify(environment))))
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const previousTimeout = AbortSignal.timeout
  const navigations = []
  let budget
  globalThis.window = { location: { assign: path => navigations.push(path) } }
  AbortSignal.timeout = milliseconds => { budget = milliseconds; return new AbortController().signal }
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/auth/company")
    assert.equal(options.method, "POST")
    assert.equal(options.credentials, "same-origin")
    assert.equal(options.cache, "no-store")
    assert.deepEqual(JSON.parse(options.body), { tenantId: tenant })
    assert.deepEqual(navigations, [])
    return Response.json({ tenantId: tenant })
  }
  try {
    await client.selectCompany(tenant, "/vendas/pedidos?status=draft")
    assert.ok(budget >= minimumBudget)
    assert.deepEqual(navigations, ["/vendas/pedidos?status=draft"])
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; AbortSignal.timeout = previousTimeout }
})

test("selection never navigates on denied, unavailable, invalid or mismatched confirmation", async () => {
  const client = await import(compile(clientSource))
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const navigations = []
  globalThis.window = { location: { assign: path => navigations.push(path) } }
  try {
    for (const [status, body, expected] of [[401, {}, /sessão expirou/], [403, {}, /não foi autorizado/], [503, {}, /temporariamente indisponível/], [200, { tenantId: otherTenant }, /não foi confirmada/], [200, {}, /não foi confirmada/], [200, null, /não foi confirmada/]]) {
      globalThis.fetch = async () => Response.json(body, { status })
      await assert.rejects(client.selectCompany(tenant, "/"), error => {
        assert.match(error.message, expected)
        if (status !== 200) assert.equal(error.status, status)
        return true
      })
    }
    globalThis.fetch = async () => new Response("not-json")
    await assert.rejects(client.selectCompany(tenant, "/"), /não foi confirmada/)
    globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError") }
    await assert.rejects(client.selectCompany(tenant, "/"), { name: "TimeoutError" })
    assert.deepEqual(navigations, [])
    globalThis.fetch = async () => Response.json({ tenantId: tenant })
    await client.selectCompany(tenant, "//foreign.invalid")
    assert.deepEqual(navigations, ["/preferencias/empresa/dados"])
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow }
})

test("auth route changes the cookie only after the API confirms its audited selection with 204", async () => {
  const previousFetch = globalThis.fetch
  const changes = []
  globalThis.__companySelectionCookies = changes
  const cookieModule = compile(`export const cookies = async () => ({set(...args){ globalThis.__companySelectionCookies.push(args) }});`)
  const sessionModule = compile(`export const currentIdentitySession = async () => ({accessToken:"fixture-only",tenantId:"${otherTenant}",expiresAt:Date.now()+120000}); export const erpConfiguration = () => ({origin:"http://fixture.local",api:"http://backend.local"}); export const cookieName = () => "erp_session"; export const seal = value => value; export const cookieOptions = maxAge => ({maxAge,httpOnly:true}); export const uuidPattern = /^[0-9a-f-]{36}$/;`)
  const source = readFileSync(new URL("../src/app/api/auth/company/route.ts", import.meta.url), "utf8").replace('"next/headers"', JSON.stringify(cookieModule)).replace('"@/server/auth/erp-session"', JSON.stringify(sessionModule))
  const { POST } = await import(compile(source))
  let calls = 0
  let upstreamStatus = 204
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url, "http://backend.local/api/v1/company-selection")
    assert.equal(options.method, "POST")
    assert.equal(options.headers["X-Tenant-Id"], tenant)
    assert.equal(options.headers.Authorization, "Bearer fixture-only")
    assert.equal(options.redirect, "error")
    return new Response(null, { status: upstreamStatus })
  }
  const request = (origin = "http://fixture.local") => new Request("http://fixture.local/api/auth/company", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant }) })
  try {
    assert.equal((await POST(request("https://foreign.invalid"))).status, 403)
    assert.equal(calls, 0)
    for (const status of [401, 403, 500, 200, 202]) {
      upstreamStatus = status
      assert.equal((await POST(request())).status, [401, 403].includes(status) ? status : 503)
      assert.equal(changes.length, 0)
    }
    upstreamStatus = 204
    const response = await POST(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { tenantId: tenant })
    assert.equal(changes.length, 1)
    assert.equal(changes[0][1].tenantId, tenant)
    assert.ok(changes[0][2].maxAge <= 120)
    assert.equal(response.headers.get("cache-control"), "no-store")
  } finally { globalThis.fetch = previousFetch; delete globalThis.__companySelectionCookies }
})
