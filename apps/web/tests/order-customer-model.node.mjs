import assert from "node:assert/strict"
import { test } from "node:test"
import {
  applyOrderCustomerLookup,
  buildOrderCustomerPayload,
  clearOrderCustomerGenerated,
  emptyOrderCustomerDraft,
  orderCustomerDraft,
  orderCustomerPayloadEqual,
  validateOrderCustomer,
  writeOrderCustomer,
} from "../src/features/sales/order-customer-model.ts"

const address = { label: "Principal", postalCode: "01001000", state: "SP", city: "São Paulo", municipalityCode: "3550308", street: "Praça da Sé", number: "10", district: "Sé", complement: null, primary: true }
const party = () => ({ personType: "juridica", legalName: "Empresa registrada", tradeName: "Fantasia", taxId: "04252011000110", email: "vendas@example.test", phone: "11999999999", isCustomer: true, isSupplier: true, status: "active", addresses: [{ ...address }, { ...address, label: "Filial", number: "20", primary: false }], contacts: [{ name: "Maria", role: "Compras", email: "maria@example.test", phone: "11888888888", primary: true }, { name: "João", role: "Financeiro", email: "joao@example.test", phone: null, primary: false }] })
const command = (input = party(), id) => ({ tenantId: "tenant-a", id, etag: id ? '"4"' : "", key: "fixed-command", body: JSON.stringify(input), input })
const response = (data, status = 200, etag = '"5"') => Response.json(data, { status, headers: etag ? { ETag: etag } : {} })
const saved = (input = party(), id = "customer-a", tenantId = "tenant-a") => ({ tenantId, canEdit: true, data: { ...input, id, revision: 5 } })

test("a one-address editor preserves other addresses, contacts, roles and supplier status", () => {
  const original = party()
  const draft = orderCustomerDraft(original)
  assert.equal(draft.responsible, "Maria")
  const input = buildOrderCustomerPayload({ ...draft, number: "12", responsible: "Maria corrigida" }, original)
  assert.equal(input.addresses[0].number, "12")
  assert.deepEqual(input.addresses[1], original.addresses[1])
  assert.deepEqual(input.contacts[0], { ...original.contacts[0], name: "Maria corrigida" })
  assert.deepEqual(input.contacts[1], original.contacts[1])
  assert.equal(input.isSupplier, true)
  assert.equal(input.status, "active")
  assert.equal(Object.hasOwn(input, "stateRegistration"), false)
  assert.equal(Object.hasOwn(input, "id"), false)
  assert.deepEqual(original, party())
})

test("an unchanged selected customer remains unchanged when displayed contact data supplies blank main fields", () => {
  const original = { ...party(), phone: null, email: null }
  const input = buildOrderCustomerPayload(orderCustomerDraft(original), original)
  assert.equal(input.phone, null)
  assert.equal(input.email, null)
  assert.equal(orderCustomerPayloadEqual(input, original), true)
})

test("an unchanged existing customer preserves an empty address label without becoming a mutation", () => {
  const original = party()
  original.addresses[0].label = ""
  const input = buildOrderCustomerPayload(orderCustomerDraft(original), original)
  assert.equal(input.addresses[0].label, "")
  assert.equal(orderCustomerPayloadEqual(input, original), true)
})

test("new customers normalize the fiscal identity and keep IE only in negotiated checkout terms", () => {
  const draft = { ...orderCustomerDraft(party()), taxId: "04.252.011/0001-10", stateRegistration: "ISENTO", phone: "11999999999", responsible: "Ana", legalName: "  Empresa nova  " }
  const input = buildOrderCustomerPayload(draft)
  assert.equal(input.taxId, "04252011000110")
  assert.equal(input.legalName, "Empresa nova")
  assert.equal(input.isCustomer, true)
  assert.equal(input.isSupplier, false)
  assert.deepEqual(input.contacts, [{ name: "Ana", role: null, phone: "11999999999", email: "vendas@example.test", primary: true }])
  assert.equal(Object.hasOwn(input, "stateRegistration"), false)
})

test("validation rejects an incomplete address, invalid CPF/CNPJ, malformed email and inconsistent IBGE", () => {
  const valid = { ...orderCustomerDraft(party()), stateRegistration: "ISENTO" }
  assert.equal(validateOrderCustomer(valid), null)
  assert.equal(validateOrderCustomer({ ...valid, personType: "fisica", taxId: "529.982.247-25" }), null)
  assert.equal(validateOrderCustomer({ ...valid, taxId: "12ABC34501DE35" }), null)
  for (const taxId of ["11111111111111", "04252011000111", "12ABC34501DE34", "04252011000110!"]) assert.equal(validateOrderCustomer({ ...valid, taxId })?.field, "taxId")
  assert.equal(validateOrderCustomer({ ...valid, personType: "fisica", taxId: "52998224724" })?.field, "taxId")
  assert.equal(validateOrderCustomer({ ...valid, email: "bad@" })?.field, "email")
  assert.equal(validateOrderCustomer({ ...valid, number: "" })?.field, "number")
  assert.equal(validateOrderCustomer({ ...valid, municipalityCode: "3304557" })?.field, "city")
  assert.equal(validateOrderCustomer(emptyOrderCustomerDraft())?.field, "taxId")
})

test("a complete order customer requires responsible, cellphone and email plus IE for a company", () => {
  const valid = { ...orderCustomerDraft(party()), stateRegistration: "ISENTO" }
  for (const field of ["responsible", "phone", "email", "stateRegistration"]) {
    assert.equal(validateOrderCustomer({ ...valid, [field]: "  " })?.field, field)
  }
  assert.equal(validateOrderCustomer({ ...valid, personType: "fisica", taxId: "52998224725", stateRegistration: "" }), null)
})

test("explicitly edited customer cellphone and email update the displayed primary contact without losing its role", () => {
  const original = party()
  const draft = orderCustomerDraft(original)
  const input = buildOrderCustomerPayload({ ...draft, phone: "11912345678", email: "novo@example.test" }, original)
  assert.equal(input.phone, "11912345678")
  assert.equal(input.email, "novo@example.test")
  assert.deepEqual(input.contacts[0], { ...original.contacts[0], phone: "11912345678", email: "novo@example.test" })
  assert.deepEqual(input.contacts[1], original.contacts[1])
  const phoneOnly = buildOrderCustomerPayload({ ...draft, phone: "11912345678" }, original)
  assert.equal(phoneOnly.contacts[0].email, "maria@example.test")
})

test("registry filling preserves manual fields and only applies IBGE for the current address", () => {
  const draft = { ...emptyOrderCustomerDraft(), taxId: "04252011000110", postalCode: "01001000", street: "Rua manual" }
  const filled = applyOrderCustomerLookup(draft, { legalName: "Nome consultado", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua da fonte", district: "Sé", municipalityCode: "3550308", isSupplier: "true" })
  assert.equal(filled.street, "Rua manual")
  assert.equal(filled.legalName, "Nome consultado")
  assert.equal(filled.municipalityCode, "3550308")
  assert.equal(Object.hasOwn(filled, "isSupplier"), false)
  assert.equal(applyOrderCustomerLookup({ ...draft, city: "Outra cidade", state: "RJ" }, { state: "SP", city: "São Paulo", municipalityCode: "3550308" }).municipalityCode, "")
  const cleared = clearOrderCustomerGenerated({ ...filled, legalName: "Editado depois" }, { legalName: "Nome consultado", city: "São Paulo", state: "SP", municipalityCode: "3550308" })
  assert.equal(cleared.legalName, "Editado depois")
  assert.equal(cleared.city, "")
  assert.equal(cleared.street, "Rua manual")
})

test("a conflicting lookup address cannot mix source address fields into a manually chosen CEP", () => {
  const current = { ...emptyOrderCustomerDraft(), postalCode: "20040-020" }
  const source = { legalName: "Empresa consultada", email: "contato@example.test", postalCode: "01001000", state: "SP", city: "São Paulo", street: "Praça da Sé", number: "10", district: "Sé", complement: "Sala 1", municipalityCode: "3550308" }
  const filled = applyOrderCustomerLookup(current, source)
  assert.equal(filled.legalName, "Empresa consultada")
  assert.equal(filled.email, "contato@example.test")
  assert.equal(filled.postalCode, "20040-020")
  for (const field of ["state", "city", "street", "number", "district", "complement", "municipalityCode"]) assert.equal(filled[field], "")
})

test("a source without CEP cannot fill any address fields when the customer already has a CEP", () => {
  const current = { ...emptyOrderCustomerDraft(), postalCode: "20040020" }
  for (const postalCode of [undefined, "", "   "]) {
    const source = { legalName: "Empresa consultada", phone: "11999999999", state: "SP", city: "São Paulo", street: "Praça da Sé", district: "Sé", number: "10", complement: "Sala 1", municipalityCode: "3550308", ...(postalCode === undefined ? {} : { postalCode }) }
    const filled = applyOrderCustomerLookup(current, source)
    assert.equal(filled.legalName, "Empresa consultada")
    assert.equal(filled.phone, "11999999999")
    assert.equal(filled.postalCode, "20040020")
    for (const field of ["state", "city", "street", "number", "district", "complement", "municipalityCode"]) assert.equal(filled[field], "")
  }
})

test("city or UF conflicts block the lookup address group while normalized matching addresses still fill", () => {
  const source = { postalCode: "01001000", state: "SP", city: "São Paulo", street: "Praça da Sé", district: "Sé", municipalityCode: "3550308", phone: "11999999999" }
  for (const current of [{ ...emptyOrderCustomerDraft(), state: "RJ" }, { ...emptyOrderCustomerDraft(), city: "Rio de Janeiro" }]) {
    const filled = applyOrderCustomerLookup(current, source)
    assert.equal(filled.postalCode, "")
    assert.equal(filled.street, "")
    assert.equal(filled.phone, "11999999999")
  }
  const filled = applyOrderCustomerLookup({ ...emptyOrderCustomerDraft(), postalCode: "01001-000", state: "sp", city: " sao   paulo ", street: "Rua manual" }, source)
  assert.equal(filled.postalCode, "01001-000")
  assert.equal(filled.city, " sao   paulo ")
  assert.equal(filled.street, "Rua manual")
  assert.equal(filled.district, "Sé")
  assert.equal(filled.municipalityCode, "3550308")
})

test("an uncertain create repeats its frozen body and key, then returns the confirmed identity", async () => {
  const pending = command()
  const first = await writeOrderCustomer(pending, async () => { throw Error("connection lost") })
  assert.equal(first.status, "uncertain")
  const result = await writeOrderCustomer(pending, async (url, init) => {
    assert.equal(url, "/api/erp/parties")
    assert.equal(init.headers["Idempotency-Key"], "fixed-command")
    assert.equal(init.body, pending.body)
    return response(saved(), 201)
  }, true)
  assert.equal(result.status, "saved")
  assert.equal(result.id, "customer-a")
  assert.equal(result.etag, '"5"')
})

test("an unresolved create retry stays uncertain through 4xx responses and retains its original command", async () => {
  const pending = command()
  for (const status of [401, 403, 409, 412, 422]) {
    const result = await writeOrderCustomer(pending, async (_url, init) => {
      assert.equal(init.headers["Idempotency-Key"], "fixed-command")
      assert.equal(init.body, pending.body)
      return response({ title: "Resultado anterior ainda não confirmado" }, status)
    }, true)
    assert.equal(result.status, "uncertain", `retry response ${status} must not release the original command`)
  }
  const result = await writeOrderCustomer(pending, async (_url, init) => {
    assert.equal(init.headers["Idempotency-Key"], "fixed-command")
    assert.equal(init.body, pending.body)
    return response(saved(), 201)
  }, true)
  assert.equal(result.status, "saved")
  assert.equal(result.id, "customer-a")
})

test("an uncertain successful update reconciles identical readback without issuing a second write", async () => {
  const result = await writeOrderCustomer(command(party(), "customer-a"), async (url, init) => {
    assert.equal(url, "/api/erp/parties/customer-a")
    assert.equal(init?.method ?? "GET", "GET")
    return response(saved())
  }, true)
  assert.equal(result.status, "saved")
  assert.equal(result.id, "customer-a")
})

test("an uncertain uncommitted update may repeat only the original ETag and body", async () => {
  const pending = command({ ...party(), legalName: "Nome alterado" }, "customer-a")
  const result = await writeOrderCustomer(pending, async (_url, init) => {
    if (!init?.method || init.method === "GET") return response(saved(party()), 200, '"4"')
    assert.equal(init.headers["If-Match"], '"4"')
    assert.equal(init.body, pending.body)
    return response(saved(pending.input))
  }, true)
  assert.equal(result.status, "saved")
  assert.equal(result.party.legalName, "Nome alterado")
})

test("a refused uncertain update replay remains uncertain after an unchanged original revision readback", async () => {
  const pending = command({ ...party(), legalName: "Minha edição" }, "customer-a")
  const result = await writeOrderCustomer(pending, async (_url, init) => {
    if (!init?.method || init.method === "GET") return response(saved(party()), 200, '"4"')
    assert.equal(init.headers["If-Match"], '"4"')
    assert.equal(init.headers["Idempotency-Key"], "fixed-command")
    assert.equal(init.body, pending.body)
    return response({ title: "Revisão alterada durante a repetição" }, 412)
  }, true)
  assert.equal(result.status, "uncertain")
})

test("different readback at a new revision blocks an uncertain update instead of overwriting it", async () => {
  const pending = command({ ...party(), legalName: "Minha edição" }, "customer-a")
  const result = await writeOrderCustomer(pending, async (_url, init) => {
    assert.equal(init?.method ?? "GET", "GET")
    return response(saved({ ...party(), legalName: "Outra edição" }))
  }, true)
  assert.equal(result.status, "conflict")
})

test("cross-tenant and incomplete confirmations preserve uncertainty; ordinary validation errors allow correction", async () => {
  assert.equal((await writeOrderCustomer(command(), async () => response(saved(party(), "customer-a", "tenant-b"), 201))).status, "uncertain")
  assert.equal((await writeOrderCustomer(command(), async () => response(saved(), 201, ""))).status, "uncertain")
  assert.equal((await writeOrderCustomer(command(), async () => response({ title: "Documento inválido" }, 422))).status, "error")
  assert.equal((await writeOrderCustomer(command(), async () => response({ title: "Serviço indisponível" }, 503))).status, "uncertain")
  assert.equal((await writeOrderCustomer(command(party(), "customer-a"), async () => response(saved(party(), "other-id")))).status, "uncertain")
})

test("editing a primary address and contact after the first entry leaves the other records untouched", () => {
  const original = party()
  original.addresses = original.addresses.map((item, index) => ({ ...item, primary: index === 1 }))
  original.contacts = original.contacts.map((item, index) => ({ ...item, primary: index === 1 }))
  const draft = orderCustomerDraft(original)
  assert.equal(draft.number, "20")
  assert.equal(draft.responsible, "João")
  const input = buildOrderCustomerPayload({ ...draft, number: "21", responsible: "João corrigido" }, original)
  assert.deepEqual(input.addresses[0], original.addresses[0])
  assert.deepEqual(input.contacts[0], original.contacts[0])
  assert.equal(input.addresses[1].number, "21")
  assert.equal(input.contacts[1].name, "João corrigido")
})

test("readback from another tenant or without an ETag cannot reconcile an uncertain update", async () => {
  const pending = command(party(), "customer-a")
  assert.equal((await writeOrderCustomer(pending, async () => response(saved(party(), "customer-a", "tenant-b")), true)).status, "uncertain")
  assert.equal((await writeOrderCustomer(pending, async () => response(saved(), 200, ""), true)).status, "uncertain")
})
