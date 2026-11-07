import "server-only"

import { currentIdentitySession, currentSession, erpConfiguration } from "@/server/auth/erp-session"

export async function forwardErp(request: Request, resource: string) {
  const opportunityResource = /^\/opportunities(?:\/[a-f0-9-]{36})?$/.test(resource) && (resource === "/opportunities" ? ["GET", "POST"] : ["GET", "PUT"]).includes(request.method)
  const metricResource = request.method === "GET" && /^\/commercial\/metrics\/(?:orders|commissions)$/.test(resource)
  const negotiationResource = metricResource || request.method === "GET" && /^\/commercial\/(?:tables\/(?:imported|national)|orders\/[a-f0-9-]{36}|approval-settings)$/.test(resource)
    || request.method === "POST" && /^\/commercial\/(?:simulate|orders|orders\/[a-f0-9-]{36}\/decision)$/.test(resource)
    || request.method === "PUT" && resource === "/commercial/approval-settings"
  if (resource.startsWith("/commercial/") && (!negotiationResource || !metricResource && new URL(request.url).search)) return Response.json({ title: "Recurso comercial inválido" }, { status: 400 })
  const warrantyResource = request.method === "GET" && /^\/warranty-(?:cases(?:\/[a-f0-9-]{36})?|service-orders)$/.test(resource)
    || request.method === "POST" && /^\/warranty-(?:policies|cases|cases\/[a-f0-9-]{36}\/(?:transition|assignment|service-order|approval|rma|quarantine)|service-orders\/[a-f0-9-]{36}\/parts|rmas\/[a-f0-9-]{36}\/transition|quarantines\/[a-f0-9-]{36}\/transition)$/.test(resource)
  if (resource.startsWith("/warranty-") && !warrantyResource) return Response.json({ title: "Recurso de garantia inválido" }, { status: 400 })
  const payrollResource = request.method === "GET" && /^\/staff-payroll$|^\/staff\/[a-f0-9-]{36}\/payroll$/i.test(resource)
    || request.method === "POST" && /^\/staff-payroll\/(?:generate|salaries)$|^\/staff-payroll\/requests\/[a-f0-9-]{36}\/review$|^\/staff\/[a-f0-9-]{36}\/payroll\/requests$/i.test(resource)
  const registryResource = (resource === "/registry-lookups" || resource === "/company-registration/lookup") && request.method === "POST"
  if ((resource === "/registry-lookups" || resource === "/company-registration/lookup")
    && (!registryResource || new URL(request.url).search)) return Response.json({ title: "Consulta inválida" }, { status: 400 })
  const accountResource = request.method === "GET" && ["/company-account", "/company-account/invoices"].includes(resource)
    || request.method === "POST" && ["/company-account/checkout", "/company-account/refresh", "/company-account/change-plan", "/company-account/cancel"].includes(resource)
  const commissionRead = /^\/commissions(?:\/[a-f0-9-]{36})?$|^\/orders\/[a-f0-9-]{36}\/commission$/i.test(resource)
  const productionRead = /^\/production\/(?:orders(?:\/[a-f0-9-]{36})?|stages)$/i.test(resource)
  const continuityResource = request.method === "GET" && (commissionRead || productionRead)
    || request.method === "PUT" && /^\/orders\/[a-f0-9-]{36}\/commission$|^\/production\/stages\/[a-f0-9-]{36}$/i.test(resource)
    || request.method === "POST" && /^\/commissions\/[a-f0-9-]{36}\/(?:adjustments|payments)$|^\/production\/(?:orders|stages)$|^\/production\/orders\/[a-f0-9-]{36}\/(?:stage|consumptions(?:\/[a-f0-9-]{36}\/reverse)?)$/i.test(resource)
  const auditResource = resource === "/audit"
  const systemResource = /^\/system\/(?:custom-fields|custom-reports|label-templates|workflows)(?:\/[a-f0-9-]{36}(?:\/(?:publish|archive))?)?$|^\/system\/files(?:\/[a-f0-9-]{36}\/archive)?$/i.test(resource)
  if (systemResource && !(resource === "/system/files" ? request.method === "GET" : resource.endsWith("/archive") || resource.endsWith("/publish") ? request.method === "POST" : ["GET", "POST", "PUT"].includes(request.method))) return Response.json({ title: "Método inválido" }, { status: 405 })
  const dashboardResource = resource === "/dashboard" && request.method === "GET"
  const productCostResource = /^\/product-costs\/[a-f0-9-]{36}$/.test(resource) && ["GET", "PUT"].includes(request.method)
  const priceTableResource = /^\/price-tables\/(?:imported|national)(?:\/(?:preview|publish))?$/.test(resource)
    && (resource.endsWith("/publish") ? request.method === "POST" : request.method === "GET")
  const fixedExpenseResource = /^\/fixed-expenses(?:\/[a-f0-9-]{36})?$/.test(resource)
    && (resource === "/fixed-expenses" ? ["GET", "POST"].includes(request.method) : request.method === "PUT")
  const commercialResource = /^\/(?:commercial-settings)\/(?:imported|national)(?:\/preview)?$/.test(resource)
    && (resource.endsWith("/preview") ? request.method === "POST" : ["GET", "PUT"].includes(request.method))
  const simulatorCollection = /^\/sales-simulator\/(?:imported|national)$/.test(resource)
  const simulatorQuote = /^\/sales-simulator\/(?:imported|national)\/quote$/.test(resource)
  const simulatorCreate = /^\/sales-simulator\/(?:imported|national)\/orders$/.test(resource)
  const orderPricingRead = /^\/orders\/[a-f0-9-]{36}\/pricing$/i.test(resource)
  const orderPricingApprove = /^\/orders\/[a-f0-9-]{36}\/pricing\/approve$/i.test(resource)
  const simulatorResource = (simulatorCollection || orderPricingRead) && request.method === "GET"
    || (simulatorQuote || simulatorCreate || orderPricingApprove) && request.method === "POST"
  const proposalCollection = resource === "/proposals"
  const proposalDetail = /^\/proposals\/[a-f0-9-]{36}$/i.test(resource)
  const proposalAction = /^\/proposals\/[a-f0-9-]{36}\/(?:send|accept|reject|cancel|revise|convert)$/i.test(resource)
  const proposalResource = proposalCollection || proposalDetail || proposalAction
  if (proposalResource && !(proposalCollection ? ["GET", "POST"] : proposalDetail ? ["GET", "PUT"] : ["POST"]).includes(request.method)) return Response.json({ title: "Método inválido" }, { status: 405 })
  const salesSettingsResource = /^\/registration-settings\/(products|parties|contact-types|tax-profiles)$/.test(resource) && ["GET", "PUT"].includes(request.method) || ["/sales-settings", "/inventory-settings", "/purchase-settings"].includes(resource) && ["GET", "PUT"].includes(request.method)
  const invitationResource = /^\/invitations(?:\/[a-f0-9-]{36}\/(?:resend|revoke))?$/i.test(resource)
  const referenceCollection = /^\/(?:product-categories|financial-categories|financial-accounts|payment-methods|warehouses|product-groups|tag-groups|tags)$/i.test(resource)
  const referenceResource = /^\/(?:product-categories|financial-categories|financial-accounts|payment-methods|warehouses|product-groups|tag-groups|tags)(?:\/[a-f0-9-]{36})?$/i.test(resource)
  const financialAccountEntriesResource = resource === "/financial-account-entries" && ["GET", "POST"].includes(request.method)
  const financialAccountTransfersResource = resource === "/financial-account-transfers" && request.method === "POST"
  const inventoryCountResource = request.method === "GET" && /^\/inventory-counts(?:\/[a-f0-9-]{36})?$/.test(resource)
    || request.method === "POST" && (/^\/inventory-counts$/.test(resource) || /^\/inventory-counts\/[a-f0-9-]{36}\/(?:lines|approve)$/.test(resource))
  const serviceKeyResource = /^\/integrations\/service-keys(?:\/[a-f0-9-]{36})?$/i.test(resource)
  const productTransferResource = /^\/products\/(?:import|export)(?:\/[a-f0-9-]{36}\/confirm|\/[a-f0-9-]{36})?$/i.test(resource)
  const returnResource = /^\/orders\/[a-f0-9-]{36}\/(?:cancel-completed|cancellations)$|^\/purchase-receipts\/[a-f0-9-]{36}\/(?:reverse|reversals)$/i.test(resource)
  if (returnResource && (resource.endsWith("/cancellations") || resource.endsWith("/reversals") ? request.method !== "GET" : request.method !== "POST")) return Response.json({ title: "Método inválido" }, { status: 405 })
  const logisticsResource = request.method === "GET" && (/^\/logistics\/postings(?:\/[a-f0-9-]{36})?$/i.test(resource) || resource === "/logistics/labels" || /^\/logistics\/checkouts(?:\/[a-f0-9-]{36}(?:\/labels)?)?$/i.test(resource))
    || request.method === "POST" && (/^\/logistics\/postings$/i.test(resource) || /^\/logistics\/postings\/[a-f0-9-]{36}\/(?:status|packages)$/i.test(resource) || /^\/logistics\/checkouts(?:\/[a-f0-9-]{36}(?:\/(?:complete|labels|lines\/\d+\/check|packages(?:\/[a-f0-9-]{36}\/status)?))?)?$/i.test(resource))
  const purchaseCollection = /^\/(?:purchase-orders|payables|financial-payables)$|^\/purchase-orders\/[a-f0-9-]{36}\/receipts$/i.test(resource)
  const purchaseResource = purchaseCollection || /^\/(?:purchase-orders|purchase-receipts|payables|financial-payables)\/[a-f0-9-]{36}$|^\/purchase-orders\/[a-f0-9-]{36}\/(?:confirm|cancel|close)$|^\/(?:payables|financial-payables)\/[a-f0-9-]{36}\/(?:payments|reverse-payment)$/i.test(resource)
  if (!opportunityResource && !negotiationResource && !warrantyResource && !simulatorResource && !dashboardResource && !productCostResource && !priceTableResource && !fixedExpenseResource && !commercialResource && !proposalResource && !payrollResource && !registryResource && !salesSettingsResource && !accountResource && !continuityResource && !auditResource && !systemResource && !returnResource && !logisticsResource && !invitationResource && !referenceResource && !financialAccountEntriesResource && !financialAccountTransfersResource && !inventoryCountResource && !serviceKeyResource && !purchaseResource && !productTransferResource && !/^\/(?:me|company|companies|financial-settings|preferences|staff|users|roles|permissions|products|stock|parties|orders|receivables)$|^\/(?:users|roles|products|parties|staff|orders|receivables)\/[a-f0-9-]{36}$|^\/stock\/movements$|^\/orders\/[a-f0-9-]{36}\/(?:confirm|cancel|complete)$|^\/receivables\/[a-f0-9-]{36}\/(?:payments|reverse-payment)$/i.test(resource)) return Response.json({ title: "Recurso inválido" }, { status: 400 })
  try {
    const config = erpConfiguration()
    const session = resource === "/companies" || registryResource ? await currentIdentitySession() : await currentSession()
    if (!session) return Response.json({ title: "Entre para acessar os dados da empresa" }, { status: 401, headers: { "Cache-Control": "no-store" } })
    if (request.method !== "GET" && request.headers.get("origin") !== config.origin) return Response.json({ title: "Origem não autorizada" }, { status: 403 })
    if (request.method !== "GET" && resource !== "/companies" && !registryResource && request.headers.get("x-tenant-id") !== session.tenantId) return Response.json({ title: "A empresa da sessão mudou. Sua edição foi preservada" }, { status: 409 })
    const headers = new Headers({ Authorization: `Bearer ${session.accessToken}`, ...(session.tenantId && resource !== "/companies" ? { "X-Tenant-Id": session.tenantId } : {}), Accept: "application/json" })
    let body: string | undefined
    const bodylessProductConfirm = productTransferResource && resource.endsWith("/confirm")
    if ((request.method === "PUT" || request.method === "POST") && !bodylessProductConfirm) {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ title: "Envie JSON" }, { status: 415 })
      const reader = request.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      const bodyLimit = /^\/products\/[a-f0-9-]{36}\/catalog$/i.test(resource) ? 14_100_000 : /^\/products\/import$/i.test(resource) ? 2_800_000 : /^\/(?:staff|products)(?:\/[a-f0-9-]{36})?$/i.test(resource) ? 400_000 : 65_536
      if (reader) for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > bodyLimit) { await reader.cancel(); return Response.json({ title: "Cadastro muito grande" }, { status: 413 }) }
        chunks.push(value)
      }
      body = Buffer.concat(chunks).toString("utf8")
      headers.set("Content-Type", "application/json")
    }
    const etag = request.headers.get("if-match")
    if (etag) headers.set("If-Match", etag)
    const commandKey = request.headers.get("idempotency-key")
    if (commandKey) headers.set("Idempotency-Key", commandKey)
    const upstream = new URL(`${config.api}/api/v1${resource}`)
    if (opportunityResource) {
      const query = new URL(request.url).searchParams
      const allowed = request.method === "GET" && resource === "/opportunities" ? ["q", "stage", "offset", "limit"] : []
      for (const [key,value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key,value)
      }
    }
    if (metricResource) {
      const query = new URL(request.url).searchParams
      for (const [key,value] of query) {
        if (key !== "month" || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key,value)
      }
    }
    if (simulatorResource) {
      const query = new URL(request.url).searchParams
      for (const [key, value] of query) {
        if (!simulatorCollection || key !== "versionId" || query.getAll(key).length !== 1 || !/^[a-f0-9-]{36}$/i.test(value)) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    if (proposalResource) {
      const query = new URL(request.url).searchParams
      const allowed = request.method !== "GET" ? [] : proposalCollection ? ["q", "status", "offset", "limit"] : proposalDetail ? ["version"] : []
      for (const [key, value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    if (accountResource) {
      const query = new URL(request.url).searchParams
      for (const [key, value] of query) {
        if (resource !== "/company-account/invoices" || !["subscriptionId", "offset"].includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    if (payrollResource) {
      for (const [key,value] of new URL(request.url).searchParams) {
        if (resource!=="/staff-payroll" || !["status","offset","limit"].includes(key) || new URL(request.url).searchParams.getAll(key).length!==1) return Response.json({title:"Filtro inválido"},{status:400})
        upstream.searchParams.set(key,value)
      }
    }
    if (continuityResource) {
      const query = new URL(request.url).searchParams
      const allowed = resource === "/production/orders" ? ["orderId", "offset", "limit"] : resource === "/commissions" ? ["offset", "limit"] : []
      for (const [key, value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    if (logisticsResource) {
      const query = new URL(request.url).searchParams
      const allowed = resource === "/logistics/postings" ? ["q", "status", "limit", "offset"] : []
      for (const [key, value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    if (dashboardResource || auditResource || resource === "/system/files" || referenceCollection || purchaseResource || financialAccountEntriesResource || inventoryCountResource && (resource === "/inventory-counts") || ["/staff", "/products", "/products/export", "/stock", "/stock/movements", "/parties", "/orders", "/receivables"].includes(resource)) {
      const query = new URL(request.url).searchParams
      const allowed = dashboardResource ? ["period"] : auditResource ? ["q", "action", "entity", "startDate", "endDate", "before"] : resource === "/system/files" ? ["q", "origin", "status", "offset", "limit"] : purchaseResource ? purchaseCollection ? ["offset", "limit"] : [] : financialAccountEntriesResource ? ["accountId", "offset", "limit"] : inventoryCountResource ? ["offset", "limit"] : resource === "/stock/movements" ? ["productId", "offset", "limit"] : resource === "/products/export" ? ["q", "status"] : ["/parties", "/staff"].includes(resource) ? ["q", "status", "role", "offset", "limit"] : resource === "/orders" ? ["q", "offset", "limit"] : resource === "/receivables" ? ["offset", "limit"] : ["q", "status", "offset", "limit"]
      if (resource === "/products") allowed.push("category_id")
      for (const [key, value] of query) {
        if (!allowed.includes(key) || query.getAll(key).length !== 1) return Response.json({ title: "Filtro inválido" }, { status: 400 })
        upstream.searchParams.set(key, value)
      }
    }
    const response = await fetch(upstream, { method: request.method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(invitationResource || accountResource ? 20000 : 10000) })
    // ETag is the backend revision used by If-Match; proxy encoding must not rewrite it.
    const output = new Headers({ "Cache-Control": "no-store, no-transform", "Content-Type": response.headers.get("content-type") || "application/json" })
    for (const name of ["etag", "x-request-id", "idempotency-replayed"]) { const value = response.headers.get(name); if (value) output.set(name, value) }
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: output })
  } catch { return Response.json({ title: "Serviço do ERP indisponível. Sua edição foi preservada" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
