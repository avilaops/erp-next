import { expect, test, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { installFrontendFixture, tenant } from "./helpers/frontend-fixture"
import { monitorOrigin as origin } from "../playwright.monitor.config"

const documentId = "22222222-2222-4222-8222-222222222222"
const runId = "33333333-3333-4333-8333-333333333333"
const xml = readFileSync(resolve("../api/src/http/fixtures/cte-received.xml"), "utf8")
const inspectionFacts = JSON.parse(readFileSync(resolve("../api/src/http/fixtures/cte-received-inspection.json"), "utf8"))
const hash = createHash("sha256").update(xml).digest("hex")
const document = { id: documentId, runId, environment: "homologation", companyTaxId: "04252011000110", nsu: "000000000000001", schema: "procCTe_v4.00.xsd", kind: "full", xmlSha256: hash, verification: "pending", createdAt: "2026-11-03T10:00:00Z" }
const requests: { url: string; method: string; tenant?: string; authorization?: string; command?: string; revision?: string; actor?: string; body?: unknown }[] = []
let mode: "ready" | "empty" | "forbidden" | "error" = "ready"
let corrupt = false
let paginated = false
let lastCode = "138"
let inspected = false
let inspectionAllowed = true
let inspectionCorrupt = false
let lostInspectionReply = false
let holdInspection: "GET" | "POST" | null = null
let releaseInspection: (() => void) | null = null
let activeTenant = tenant
let activeSubject = "cte-actor-a"
let canRead = true
const carrierId = "55555555-5555-4555-8555-555555555555"
const orderId = "66666666-6666-4666-8666-666666666666"
const commercialLinkId = "77777777-7777-4777-8777-777777777777"
let commercialRevision = 1
let commercialAllowed = true
let commercialPurchaseRead = true
let commercialCarrierAvailable = true
let commercialCorrupt = false
let commercialMode: "ready" | "lost" | "conflict" = "ready"
let holdCommercial: "GET" | "POST" | null = null
let releaseCommercial: (() => void) | null = null
let commercialRows: Record<string, unknown>[] = []
let commercialCommands = new Set<string>()
let swapActorOnVerification = 0
let accessFailure: "none" | "503" | "network" = "none"
let failAccessAfterCommercialPost: "none" | "503" | "network" = "none"
function commercialView() {
  const data = commercialRows.map(row => !commercialPurchaseRead && row.kind === "purchase" ? { ...row, restricted: true, canUnlink: false, orderId: null, counterpartyName: null, orderAmountCents: null, orderRevision: null, reason: null } : { ...row, canUnlink: commercialAllowed })
  return { tenantId: tenant, documentId, inspectionId: "44444444-4444-4444-8444-444444444444", sourceXmlSha256: commercialCorrupt ? "0".repeat(64) : hash, revision: commercialRevision, serviceCents: "15001", allocatedCents: commercialRows.length ? "15001" : "0", canLinkPurchase: commercialAllowed && commercialPurchaseRead, canLinkSale: commercialAllowed, carrier: { partyId: commercialCarrierAvailable ? carrierId : null, taxId: inspectionFacts.carrier.value, name: "Transportadora cadastrada", ownCompany: false, available: commercialCarrierAvailable }, data }
}
function seedCommercialLink() {
  inspected = true; commercialRevision = 2
  commercialRows = [{ id: commercialLinkId, kind: "purchase", orderId, carrierPartyId: carrierId, carrierTaxId: inspectionFacts.carrier.value, carrierName: "Transportadora cadastrada", counterpartyName: "Fornecedor sintético", orderAmountCents: "50000", orderRevision: 1, freightCents: "15001", reason: "Conferência anterior registrada", createdAt: "2026-11-03T15:00:00Z", canUnlink: true, restricted: false }]
}
function releaseHeldCommercial() { const release = releaseCommercial; releaseCommercial = null; release?.() }
async function openCommercial(page: Page) {
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Ver vínculos comerciais" }).click()
  return page.getByRole("region", { name: "Vínculos comerciais do CT-e" })
}
async function prepareCommercial(page: Page) {
  const panel = await openCommercial(page)
  await panel.getByRole("button", { name: "Selecionar compra", exact: true }).click()
  await panel.getByRole("button", { name: /Selecionar compra.*Fornecedor sintético/ }).click()
  await expect(panel.getByLabel("Frete associado (R$)", { exact: true })).toHaveValue("")
  await panel.getByLabel("Frete associado (R$)", { exact: true }).fill("150,01")
  await panel.getByLabel("Motivo da conferência", { exact: true }).fill("Conferi a compra e os documentos transportados")
  await panel.getByLabel("Conferi a transportadora e o pedido", { exact: true }).check()
  return panel
}
function releaseHeldInspection() { const release = releaseInspection; releaseInspection = null; release?.() }

const upstream = createServer((request, response) => {
  const observed: (typeof requests)[number] = { url: request.url || "", method: request.method || "", tenant: request.headers["x-tenant-id"] as string, authorization: request.headers.authorization, command: request.headers["idempotency-key"] as string, revision: request.headers["if-match"] as string, actor: request.headers["x-actor-subject"] as string }
  requests.push(observed)
  response.setHeader("Content-Type", "application/json")
  if (mode === "forbidden" || mode === "error") {
    response.statusCode = mode === "forbidden" ? 403 : 503
    return response.end(JSON.stringify({ title: mode === "forbidden" ? "Sem permissão para consultar CT-e" : "Leitura CT-e indisponível" }))
  }
  const url = new URL(request.url || "/", origin)
  const commercialBase = `/api/v1/fiscal/cte-distribution/documents/${documentId}`
  if (url.pathname === `${commercialBase}/commercial-links` && request.method === "GET") {
    response.setHeader("ETag", `"${commercialRevision}"`)
    const snapshot = commercialView()
    if (holdCommercial === "GET") { releaseCommercial = () => response.end(JSON.stringify(snapshot)); return }
    return response.end(JSON.stringify(snapshot))
  }
  if (url.pathname === `${commercialBase}/commercial-options` && request.method === "GET") {
    const kind = url.searchParams.get("kind") || "purchase"
    return response.end(JSON.stringify({ tenantId: tenant, documentId, sourceXmlSha256: hash, kind, offset: 0, limit: 25, total: 1, data: [{ id: orderId, counterpartyName: kind === "purchase" ? "Fornecedor sintético" : "Cliente sintético", counterpartyTaxId: "11222333000181", dueDate: "2026-11-10", amountCents: "50000", status: "confirmed", revision: 1 }] }))
  }
  if (request.method === "POST" && [
    `${commercialBase}/commercial-links`, `${commercialBase}/commercial-links/${commercialLinkId}/unlink`,
  ].includes(url.pathname)) {
    void (async () => {
      let bytes = ""
      for await (const chunk of request) bytes += chunk.toString()
      const input = JSON.parse(bytes)
      observed.body = input
      const actualSubject = request.headers.authorization === "Bearer frontend-integration-fixture-b" ? "cte-actor-b" : "cte-actor-a"
      if (observed.actor && observed.actor !== Buffer.from(actualSubject).toString("base64url")) {
        response.statusCode = 409
        response.end(JSON.stringify({ title: "O usuário que conferiu mudou; nenhum vínculo foi aplicado" }))
        return
      }
      const command = `${actualSubject}:${observed.command}`
      if (commercialCommands.has(command)) { response.end(JSON.stringify(commercialView())); return }
      if (commercialMode !== "ready") {
        response.statusCode = commercialMode === "lost" ? 503 : 412
        if (commercialMode === "conflict") commercialRevision++
        response.end(JSON.stringify({ title: commercialMode === "lost" ? "Resultado do vínculo não confirmado" : "Revisão dos vínculos mudou" }))
        return
      }
      if (url.pathname.endsWith("/unlink")) commercialRows = []
      else commercialRows = [{ id: commercialLinkId, kind: input.kind, orderId: input.orderId, carrierPartyId: input.carrierPartyId, carrierTaxId: inspectionFacts.carrier.value, carrierName: "Transportadora cadastrada", counterpartyName: input.kind === "purchase" ? "Fornecedor sintético" : "Cliente sintético", orderAmountCents: "50000", orderRevision: 1, freightCents: input.freightCents, reason: input.reason, createdAt: "2026-11-03T15:00:00Z", canUnlink: commercialAllowed, restricted: false }]
      commercialRevision++
      commercialCommands.add(command)
      response.statusCode = url.pathname.endsWith("/unlink") ? 200 : 201
      response.setHeader("ETag", `"${commercialRevision}"`)
      const snapshot = commercialView()
      if (failAccessAfterCommercialPost !== "none") accessFailure = failAccessAfterCommercialPost
      if (holdCommercial === "POST") { releaseCommercial = () => response.end(JSON.stringify(snapshot)); return }
      response.end(JSON.stringify(snapshot))
    })().catch(() => { response.statusCode = 500; response.end(JSON.stringify({ title: "Fixture inválida" })) })
    return
  }
  if (url.pathname === "/api/v1/fiscal/cte-distribution/status") return response.end(JSON.stringify({ tenantId: tenant, environment: "homologation", companyTaxId: document.companyTaxId, lastNsu: document.nsu, maxNsu: document.nsu, revision: 2, nextQueryAt: "2026-11-03T12:00:00Z", lastCode, running: false, canQuery: true }))
  if (url.pathname === "/api/v1/fiscal/cte-distribution/documents") {
    const offset = Number(url.searchParams.get("offset") || 0)
    const data = mode === "empty" ? [] : paginated ? Array.from({ length: offset ? 1 : 25 }, (_, index) => ({ ...document, id: `${String(offset + index + 1).padStart(8, "0")}-2222-4222-8222-222222222222`, nsu: String(offset + index + 1).padStart(15, "0") })) : [document]
    return response.end(JSON.stringify({ tenantId: tenant, environment: "homologation", data, total: mode === "empty" ? 0 : paginated ? 26 : 1 }))
  }
  if (url.pathname === `/api/v1/fiscal/cte-distribution/documents/${documentId}`) return response.end(JSON.stringify({ ...document, xml: corrupt ? `${xml} ` : xml }))
  const inspection = { id: "44444444-4444-4444-8444-444444444444", documentId, sourceXmlSha256: hash, inspectorVersion: "cte-received-v1", document: inspectionFacts, createdAt: "2026-11-03T15:00:00Z" }
  const detail = () => ({ tenantId: tenant, documentId, sourceXmlSha256: inspectionCorrupt ? "0".repeat(64) : hash, canInspect: inspectionAllowed, data: inspected ? inspection : null })
  if (url.pathname === `/api/v1/fiscal/cte-distribution/documents/${documentId}/inspection`) {
    if (holdInspection === "GET") { releaseInspection = () => response.end(JSON.stringify(detail())); return }
    return response.end(JSON.stringify(detail()))
  }
  if (url.pathname === `/api/v1/fiscal/cte-distribution/documents/${documentId}/inspect` && request.method === "POST") {
    if (!inspectionAllowed) { response.statusCode = 403; return response.end(JSON.stringify({ title: "Conferência local indisponível" })) }
    if (lostInspectionReply) { response.statusCode = 503; return response.end(JSON.stringify({ title: "Conferência não confirmada" })) }
    inspected = true
    response.statusCode = 201
    if (holdInspection === "POST") { releaseInspection = () => response.end(JSON.stringify(detail())); return }
    return response.end(JSON.stringify(detail()))
  }
  if (url.pathname === `/api/v1/fiscal/cte-distribution/runs/${runId}`) return response.end(JSON.stringify({ runId, environment: "homologation", companyTaxId: document.companyTaxId, requestedNsu: "000000000000000", status: "completed", code: "138", documentCount: 1, completedAt: "2026-11-03T10:00:00Z" }))
  response.statusCode = 404
  response.end(JSON.stringify({ title: "Recurso não encontrado" }))
})

test.beforeAll(async () => { await new Promise<void>(resolve => upstream.listen(33929, "127.0.0.1", resolve)) })
test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })
test.beforeEach(async ({ context, page }) => {
  releaseHeldInspection()
  releaseHeldCommercial()
  mode = "ready"; corrupt = false; paginated = false; lastCode = "138"; inspected = false; inspectionAllowed = true; inspectionCorrupt = false; lostInspectionReply = false; holdInspection = null; activeTenant = tenant; activeSubject = "cte-actor-a"; canRead = true; requests.length = 0
  commercialRevision = 1; commercialAllowed = true; commercialPurchaseRead = true; commercialCarrierAvailable = true; commercialCorrupt = false; commercialMode = "ready"; holdCommercial = null; commercialRows = []; commercialCommands = new Set(); swapActorOnVerification = 0; accessFailure = "none"; failAccessAfterCommercialPost = "none"
  await installFrontendFixture(context, origin)
  await context.unroute("**/api/erp/**")
  await page.route("**/api/erp/me", async route => {
    if (accessFailure === "503") return route.fulfill({ status: 503, json: { title: "Acesso temporariamente indisponível" } })
    if (accessFailure === "network") return route.abort("failed")
    const snapshot = { tenant: { id: activeTenant, legalName: activeTenant === tenant ? "Empresa CT-e sintética" : "Empresa B sintética" }, identity: { subject: activeSubject }, permissions: [...(canRead ? ["fiscal.cte.read"] : []), "fiscal.cte.inspect", "catalog.parties.read", ...(commercialPurchaseRead ? ["purchasing.orders.read"] : []), "sales.orders.read", ...(commercialAllowed ? ["fiscal.cte.link"] : [])] }
    if (swapActorOnVerification > 0 && --swapActorOnVerification === 0) {
      activeSubject = "cte-actor-b"
      await installFrontendFixture(context, origin, tenant, "frontend-integration-fixture-b")
      await context.unroute("**/api/erp/**")
    }
    return route.fulfill({ json: snapshot })
  })
})

test("vínculos CT-e BFF fixa empresa e encaminha revisão, chave e payload da conferência", async ({ context }) => {
  const base = `/api/erp/fiscal/cte-distribution/documents/${documentId}`
  const headers = { "X-Tenant-Id": tenant, Origin: origin, "If-Match": '"1"', "Idempotency-Key": "88888888-8888-4888-8888-888888888888", "X-Actor-Subject": "Y3RlLWFjdG9yLWE" }
  expect((await context.request.get(`${base}/commercial-links`, { headers: { "X-Tenant-Id": tenant } })).status()).toBe(200)
  expect((await context.request.get(`${base}/commercial-links`)).status()).toBe(409)
  expect((await context.request.get(`${base}/commercial-options?kind=purchase&offset=0&limit=25`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${base}/commercial-options?kind=purchase&environment=production`, { headers })).status()).toBe(400)
  const data = { kind: "purchase", orderId, carrierPartyId: carrierId, freightCents: "15001", reason: "Conferência explícita do pedido" }
  expect((await context.request.post(`${base}/commercial-links`, { headers: { "X-Tenant-Id": tenant, Origin: origin, "If-Match": '"1"', "Idempotency-Key": headers["Idempotency-Key"] }, data })).status()).toBe(409)
  expect((await context.request.post(`${base}/commercial-links`, { headers: { ...headers, Origin: "https://outside.example" }, data })).status()).toBe(403)
  expect((await context.request.post(`${base}/commercial-links`, { headers, data })).status()).toBe(201)
  expect((await context.request.post(`${base}/commercial-links/${commercialLinkId}/unlink`, { headers: { ...headers, "If-Match": '"2"', "Idempotency-Key": "99999999-9999-4999-8999-999999999999" }, data: { reason: "Corrigir a associação" } })).status()).toBe(200)
  expect(requests).toHaveLength(4)
  const writes = requests.filter(value => value.method === "POST")
  expect(writes[0].body).toEqual(data)
  expect(writes[0].revision).toBe('"1"')
  expect(writes[1].revision).toBe('"2"')
  expect(writes.map(value => value.command)).toEqual([headers["Idempotency-Key"], "99999999-9999-4999-8999-999999999999"])
  expect(writes.every(value => value.actor === "Y3RlLWFjdG9yLWE" && value.tenant === tenant)).toBe(true)
})

test("central CT-e associa frete a compra conferida e desfaz sem criar operação financeira", async ({ page }) => {
  inspected = true
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Ver vínculos comerciais" }).click()
  const panel = page.getByRole("region", { name: "Vínculos comerciais do CT-e" })
  await panel.getByRole("button", { name: "Selecionar compra", exact: true }).click()
  await panel.getByRole("button", { name: /Selecionar compra.*Fornecedor sintético/ }).click()
  await panel.getByLabel("Frete associado (R$)", { exact: true }).fill("150,01")
  await panel.getByLabel("Motivo da conferência", { exact: true }).fill("Conferi a compra e os documentos transportados")
  await panel.getByLabel("Conferi a transportadora e o pedido", { exact: true }).check()
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(panel.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toBeVisible()
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Desfazer vínculo", exact: true }).click()
  await panel.getByLabel("Motivo do desfazimento", { exact: true }).fill("Corrigir a compra selecionada")
  await panel.getByRole("button", { name: "Confirmar desfazimento", exact: true }).click()
  await expect(panel.getByRole("status").filter({ hasText: "Vínculo desfeito" })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Desfazer vínculo", exact: true })).toHaveCount(0)
  expect(requests.filter(value => value.method === "POST").map(value => value.url)).toEqual([`/api/v1/fiscal/cte-distribution/documents/${documentId}/commercial-links`, `/api/v1/fiscal/cte-distribution/documents/${documentId}/commercial-links/${commercialLinkId}/unlink`])
})

test("vínculo CT-e incerto repete exatamente chave, revisão e payload já conferidos", async ({ page }) => {
  inspected = true; commercialMode = "lost"
  const panel = await prepareCommercial(page)
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(panel.getByRole("alert").filter({ hasText: "não confirmado" })).toBeVisible()
  commercialMode = "ready"
  await panel.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(panel.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toBeVisible()
  const writes = requests.filter(value => value.method === "POST")
  expect(writes).toHaveLength(2)
  expect(writes[0].body).toEqual({ kind: "purchase", orderId, carrierPartyId: carrierId, freightCents: "15001", reason: "Conferi a compra e os documentos transportados" })
  expect(writes[1].body).toEqual(writes[0].body)
  expect(writes[1].command).toBe(writes[0].command)
  expect(writes[1].revision).toBe(writes[0].revision)
})

test("vínculo CT-e impede escrita por outro usuário entre a conferência e o BFF", async ({ page }) => {
  inspected = true
  const panel = await prepareCommercial(page)
  // The second verification is the client's final preflight; return its captured A
  // response after replacing the real encrypted session cookie with B.
  swapActorOnVerification = 2
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: /usuário/ })).toBeVisible()
  const writes = requests.filter(value => value.method === "POST")
  expect(writes).toHaveLength(1)
  expect(writes[0].authorization).toBe("Bearer frontend-integration-fixture-b")
  expect(writes[0].actor).toBe("Y3RlLWFjdG9yLWE")
  expect(commercialRows).toHaveLength(0)
  await expect(page.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toHaveCount(0)
})

for (const failure of ["503", "network"] as const) test(`vínculo CT-e conserva comando após falha ${failure} no acesso posterior ao POST`, async ({ page }) => {
  inspected = true
  const panel = await prepareCommercial(page)
  failAccessAfterCommercialPost = failure
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Repetir confirmação", exact: true })).toBeVisible()
  await expect(page.getByText("Fornecedor sintético", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("main").getByText("Empresa CT-e sintética", { exact: true })).toHaveCount(0)
  accessFailure = "none"; failAccessAfterCommercialPost = "none"
  await panel.getByRole("button", { name: "Repetir confirmação", exact: true }).click()
  await expect(panel.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toBeVisible()
  const writes = requests.filter(value => value.method === "POST")
  expect(writes).toHaveLength(2)
  expect(writes[0].body).toEqual(writes[1].body)
  expect(writes[0].revision).toBe(writes[1].revision)
  expect(writes[0].command).toBe(writes[1].command)
  expect(writes[0].actor).toBe(writes[1].actor)
})

test("conflito de vínculo CT-e preserva edição e exige nova conferência na revisão atual", async ({ page }) => {
  inspected = true; commercialMode = "conflict"
  const panel = await prepareCommercial(page)
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(panel.getByRole("alert").filter({ hasText: /revisão/i })).toBeVisible()
  await expect(panel.getByLabel("Frete associado (R$)", { exact: true })).toHaveValue("150,01")
  await expect(panel.getByLabel("Motivo da conferência", { exact: true })).toHaveValue("Conferi a compra e os documentos transportados")
  await expect(panel.getByLabel("Conferi a transportadora e o pedido", { exact: true })).not.toBeChecked()
  commercialMode = "ready"
  await panel.getByRole("button", { name: "Atualizar vínculos", exact: true }).click()
  await panel.getByLabel("Conferi a transportadora e o pedido", { exact: true }).check()
  await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  await expect(panel.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toBeVisible()
  const writes = requests.filter(value => value.method === "POST")
  expect(writes).toHaveLength(2)
  expect(writes.map(value => value.revision)).toEqual(['"1"', '"2"'])
  expect(writes[1].command).not.toBe(writes[0].command)
})

test("vínculos CT-e respeitam leitura comercial e escondem contraparte após revogação", async ({ page }) => {
  seedCommercialLink(); commercialAllowed = false
  let panel = await openCommercial(page)
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Selecionar compra", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Desfazer vínculo", exact: true })).toHaveCount(0)
  commercialAllowed = true; commercialPurchaseRead = false
  panel = await openCommercial(page)
  await expect(panel.getByText("Pedido com acesso restrito", { exact: true })).toBeVisible()
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Desfazer vínculo", exact: true })).toHaveCount(0)
  expect(requests.every(value => value.method === "GET")).toBe(true)
})

test("vínculo CT-e exige transportadora cadastrada e limpa resposta de outra conferência", async ({ page }) => {
  inspected = true; commercialCarrierAvailable = false
  let panel = await openCommercial(page)
  await expect(panel.getByText(/Cadastre uma transportadora ativa/)).toBeVisible()
  await expect(panel.getByRole("button", { name: "Selecionar compra", exact: true })).toBeDisabled()
  seedCommercialLink(); commercialCarrierAvailable = true
  panel = await openCommercial(page)
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toBeVisible()
  commercialCorrupt = true
  await panel.getByRole("button", { name: "Atualizar vínculos", exact: true }).click()
  await expect(panel.getByRole("alert").filter({ hasText: "não correspondem" })).toBeVisible()
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toHaveCount(0)
})

for (const method of ["GET", "POST"] as const) for (const change of ["actor", "permission"] as const) test(`vínculo CT-e descarta ${method} tardio após mudança de ${change}`, async ({ page }) => {
  inspected = true
  if (method === "POST") {
    const panel = await prepareCommercial(page)
    holdCommercial = "POST"
    await panel.getByRole("button", { name: "Confirmar vínculo", exact: true }).click()
  } else {
    seedCommercialLink(); holdCommercial = "GET"
    await openCommercial(page)
  }
  try {
    await expect.poll(() => releaseCommercial !== null).toBe(true)
    if (change === "actor") activeSubject = "cte-actor-b"
    else commercialPurchaseRead = false
    releaseHeldCommercial()
    await expect(page.getByRole("alert").filter({ hasText: change === "actor" ? "O usuário da sessão mudou" : "acesso atual" })).toBeVisible()
    await expect(page.getByText("Fornecedor sintético", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("status").filter({ hasText: "Vínculo comercial registrado" })).toHaveCount(0)
  } finally { releaseHeldCommercial() }
})

test("vínculos CT-e em cinco tamanhos preservam resumo, histórico e ações sem corte horizontal", async ({ page }, info) => {
  seedCommercialLink()
  const panel = await openCommercial(page)
  await expect(panel.getByText("Fornecedor sintético", { exact: true })).toBeVisible()
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`cte-links-${width}.png`), fullPage: true })
  }
})

test("conferência CT-e BFF fixa empresa e protege a escrita local por sessão e origem", async ({ context }) => {
  const base = `/api/erp/fiscal/cte-distribution/documents/${documentId}`
  const headers = { "X-Tenant-Id": tenant, Origin: origin, "Idempotency-Key": "55555555-5555-4555-8555-555555555555" }
  expect((await context.request.get(`${base}/inspection`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${base}/inspection`)).status()).toBe(409)
  expect((await context.request.get(`${base}/inspection?environment=production`, { headers })).status()).toBe(400)
  expect((await context.request.get(base.replace(documentId, "not-a-uuid") + "/inspection", { headers })).status()).toBe(400)
  expect((await context.request.post(`${base}/inspect`, { headers: { ...headers, Origin: "https://outside.example" }, data: {} })).status()).toBe(403)
  expect((await context.request.post(`${base}/inspect`, { headers: { ...headers, "X-Tenant-Id": runId }, data: {} })).status()).toBe(409)
  expect((await context.request.post(`${base}/inspect`, { headers, data: {} })).status()).toBe(201)
  expect((await context.request.get(`${base}/inspect`, { headers })).status()).toBe(405)
  expect(requests).toHaveLength(2)
  expect(requests.every(request => request.tenant === tenant && request.authorization === "Bearer frontend-integration-fixture")).toBe(true)
})

test("central CT-e exibe conferência local e transportadora sem declarar validação externa", async ({ page }) => {
  await page.goto("/fiscal/ctes")
  await expect(page.getByRole("button", { name: "Ver conferência" })).toBeVisible()
  await page.getByRole("button", { name: "Ver conferência" }).click()
  const panel = page.getByRole("region", { name: "Conferência local do CT-e" })
  await expect(panel.getByText("Nenhuma conferência local registrada.", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Conferir XML" }).click()
  await expect(panel.getByText("TRANSPORTADORA FICTICIA", { exact: true })).toBeVisible()
  await expect(panel.getByText("R$ 150,01", { exact: true })).toHaveCount(2)
  await expect(panel.getByText("35261012345678000195550010000001231482917364", { exact: true })).toBeVisible()
  await expect(panel.getByText("Confiança do certificado, autenticidade do protocolo e situação fiscal atual não verificadas.", { exact: true })).toBeVisible()
  expect(requests.filter(request => request.method === "POST").map(request => request.url)).toEqual([`/api/v1/fiscal/cte-distribution/documents/${documentId}/inspect`])
  expect(requests.some(request => /\/query|\/manifest|\/issue/.test(request.url))).toBe(false)
  await expect(page.getByText("Situação fiscal externa pendente", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Consultar captura" }).click()
  await expect(page.getByRole("status").filter({ hasText: "A situação fiscal externa permanece pendente" })).toBeVisible()
  await expect(page.getByText(/conferência individual.*pendente/i)).toHaveCount(0)
})

test("conferência CT-e respeita capacidade de leitura e recusa resposta de outro arquivo", async ({ page }) => {
  inspectionAllowed = false
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  const panel = page.getByRole("region", { name: "Conferência local do CT-e" })
  await expect(panel.getByText("Conferência local indisponível nesta empresa. O XML original continua disponível.", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Conferir XML" })).toHaveCount(0)
  inspectionCorrupt = true
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "não corresponde" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  expect(requests.every(request => request.method === "GET")).toBe(true)
})

test("conferência CT-e incerta preserva chave para repetição após atualizar a mesma empresa", async ({ page }) => {
  lostInspectionReply = true
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Conferir XML" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Conferência não confirmada" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  lostInspectionReply = false
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Conferir XML" }).click()
  await expect(page.getByRole("status").filter({ hasText: /^Conferência local registrada/ })).toBeVisible()
  const writes = requests.filter(request => request.method === "POST")
  expect(writes).toHaveLength(2)
  expect(writes[0].command).toMatch(/^[a-f0-9-]{36}$/)
  expect(writes[1].command).toBe(writes[0].command)
})

test("conferência CT-e não reaproveita comando incerto após trocar usuário no mesmo tenant", async ({ page }) => {
  lostInspectionReply = true
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Conferir XML" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Conferência não confirmada" })).toBeVisible()
  activeSubject = "cte-actor-b"
  lostInspectionReply = false
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await page.getByRole("button", { name: "Ver conferência" }).click()
  await page.getByRole("button", { name: "Conferir XML" }).click()
  await expect(page.getByRole("status").filter({ hasText: /^Conferência local registrada/ })).toBeVisible()
  const writes = requests.filter(request => request.method === "POST")
  expect(writes).toHaveLength(2)
  expect(writes[1].command).not.toBe(writes[0].command)
})

for (const method of ["GET", "POST"] as const) test(`conferência CT-e descarta resposta ${method} tardia após mudança real de empresa`, async ({ page, context }) => {
  await page.goto("/fiscal/ctes")
  if (method === "POST") {
    await page.getByRole("button", { name: "Ver conferência" }).click()
    holdInspection = "POST"
    await page.getByRole("button", { name: "Conferir XML" }).click()
  } else {
    holdInspection = "GET"
    await page.getByRole("button", { name: "Ver conferência" }).click()
  }
  try {
    await expect.poll(() => releaseInspection !== null).toBe(true)
    await installFrontendFixture(context, origin, documentId)
    await context.unroute("**/api/erp/**")
    activeTenant = documentId
    releaseHeldInspection()
    await expect(page.getByRole("alert").filter({ hasText: /empresa.*mudou/i })).toBeVisible()
    await expect(page.getByText("TRANSPORTADORA FICTICIA", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  } finally { releaseHeldInspection() }
})

for (const method of ["GET", "POST"] as const) for (const change of ["revoked", "actor"] as const) test(`conferência CT-e descarta ${method} pendente quando ${change} muda no mesmo tenant`, async ({ page }) => {
  inspected = method === "GET"
  await page.goto("/fiscal/ctes")
  if (method === "POST") {
    await page.getByRole("button", { name: "Ver conferência" }).click()
    holdInspection = "POST"
    await page.getByRole("button", { name: "Conferir XML" }).click()
  } else {
    holdInspection = "GET"
    await page.getByRole("button", { name: "Ver conferência" }).click()
  }
  try {
    await expect.poll(() => releaseInspection !== null).toBe(true)
    if (change === "revoked") canRead = false
    else activeSubject = "cte-actor-b"
    releaseHeldInspection()
    await expect(page.getByRole("alert").filter({ hasText: change === "revoked" ? "Sem permissão atual" : "O usuário da sessão mudou" })).toBeVisible()
    await expect(page.getByText("TRANSPORTADORA FICTICIA", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  } finally { releaseHeldInspection() }
})

test("conferência CT-e em cinco tamanhos preserva fatos e ações sem corte horizontal", async ({ page }, info) => {
  inspected = true
  await page.goto("/fiscal/ctes")
  await page.getByRole("button", { name: "Ver conferência" }).click()
  const panel = page.getByRole("region", { name: "Conferência local do CT-e" })
  await expect(panel.getByText("TRANSPORTADORA FICTICIA", { exact: true })).toBeVisible()
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`cte-inspection-${width}.png`), fullPage: true })
  }
})

test("CT-e BFF exige sessão e tenant fixado, limita filtros e transporta apenas leituras", async ({ context, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: origin })
  try { expect((await anonymous.get("/api/erp/fiscal/cte-distribution/status")).status()).toBe(401) }
  finally { await anonymous.dispose() }
  const path = "/api/erp/fiscal/cte-distribution"
  const headers = { "X-Tenant-Id": tenant }
  expect((await context.request.get(`${path}/status`)).status()).toBe(409)
  expect((await context.request.get(`${path}/status`, { headers: { "X-Tenant-Id": documentId } })).status()).toBe(409)
  expect((await context.request.get(`${path}/status`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${path}/documents?offset=0&limit=25`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${path}/documents?limit=1&limit=2`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}/documents?environment=production`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}/documents/not-a-uuid`, { headers })).status()).toBe(400)
  expect((await context.request.get(`${path}/documents/${documentId}`, { headers })).status()).toBe(200)
  expect((await context.request.get(`${path}/runs/${runId}`, { headers })).status()).toBe(200)
  expect((await context.request.post(`${path}/status`, { headers, data: {} })).status()).toBe(405)
  expect(requests).toHaveLength(4)
  expect(requests.every(value => value.method === "GET" && value.tenant === tenant && value.authorization === "Bearer frontend-integration-fixture")).toBe(true)
})

test("central CT-e baixa XML íntegro e consulta captura sem transmitir à SEFAZ", async ({ page }) => {
  await page.goto("/fiscal/ctes")
  await expect(page.getByRole("heading", { name: "CT-e recebidos" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "CT-e recebidos" }).locator("..").getByText("Empresa CT-e sintética", { exact: true })).toBeVisible()
  await expect(page.getByText("Situação fiscal externa pendente", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Consultar SEFAZ|Capturar CT-e/ })).toHaveCount(0)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe(`CTE-${document.nsu}.xml`)
  expect(await readFile((await saved.path())!, "utf8")).toBe(xml)
  await page.getByRole("button", { name: "Consultar captura" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Captura concluída" })).toBeVisible()
  expect(requests.every(value => value.method === "GET")).toBe(true)
})

test("central CT-e remove linhas antigas em erro ou revogação e permite recuperar leitura vazia", async ({ page }) => {
  await page.goto("/fiscal/ctes")
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeVisible()
  mode = "forbidden"
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Sem permissão" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  mode = "error"
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "indisponível" })).toBeVisible()
  mode = "empty"
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await expect(page.getByText("Nenhum arquivo CT-e coletado em homologação.", { exact: true })).toBeVisible()
  const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
  await expect(files).toBeVisible()
  await expect(files.getByRole("alert")).toHaveCount(0)
})

test("falha persistida na última captura não oculta arquivos anteriores nem repete transporte", async ({ page }) => {
  for (const [code, label] of [["transport_uncertain", "Resposta da captura não confirmada"], ["invalid_batch", "Lote recusado por inconsistência"], ["persistence_failed", "Falha ao armazenar o lote"]]) {
    lastCode = code
    await page.goto("/fiscal/ctes")
    await expect(page.getByText(`Última captura: ${label}.`, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeEnabled()
    const files = page.getByRole("region", { name: /^Arquivos armazenados/ })
    await expect(files).toBeVisible()
    await expect(files.getByRole("alert")).toHaveCount(0)
  }
  expect(requests.every(value => value.method === "GET")).toBe(true)
})

test("XML divergente e troca de empresa impedem download e não acessam documento de outro tenant", async ({ page, context }) => {
  let downloads = 0
  page.on("download", () => downloads++)
  await page.goto("/fiscal/ctes")
  corrupt = true
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "não corresponde" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  corrupt = false
  await page.getByRole("button", { name: "Atualizar arquivos" }).click()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeEnabled()
  const before = requests.length
  await installFrontendFixture(context, origin, documentId)
  await context.unroute("**/api/erp/**")
  await page.getByRole("button", { name: "Baixar XML original" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "A empresa da sessão mudou" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
  expect(requests).toHaveLength(before)
  expect(downloads).toBe(0)
})

test("falha na leitura individual remove dados antigos e permite atualizar sem repetir captura", async ({ page }) => {
  for (const action of ["Baixar XML original", "Consultar captura"]) {
    await page.goto("/fiscal/ctes")
    await expect(page.getByRole("button", { name: action })).toBeEnabled()
    mode = "error"
    await page.getByRole("button", { name: action }).click()
    await expect(page.getByRole("alert").filter({ hasText: "indisponível" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Consultar captura" })).toHaveCount(0)
    mode = "ready"
    await page.getByRole("button", { name: "Atualizar arquivos" }).click()
    await expect(page.getByRole("button", { name: action })).toBeEnabled()
  }
  expect(requests.every(value => value.method === "GET")).toBe(true)
})

test("paginação CT-e preserva filtros permitidos e cinco tamanhos não cortam ações", async ({ page }, info) => {
  paginated = true
  await page.goto("/fiscal/ctes")
  await expect(page.getByRole("button", { name: "Próximos arquivos" })).toBeEnabled()
  await page.getByRole("button", { name: "Próximos arquivos" }).click()
  await expect(page.getByText("26 a 26 de 26", { exact: true })).toBeVisible()
  await expect(page.getByText("NSU 000000000000026", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Próximos arquivos" })).toBeDisabled()
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    await expect(page.getByRole("button", { name: "Baixar XML original" })).toBeVisible()
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`cte-${width}.png`), fullPage: true })
  }
  await page.getByRole("button", { name: "Arquivos anteriores" }).click()
  await expect(page.getByText("1 a 25 de 26", { exact: true })).toBeVisible()
})
