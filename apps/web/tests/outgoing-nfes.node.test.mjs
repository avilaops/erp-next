import test from "node:test"
import assert from "node:assert/strict"
import { mergeNotes, filterNotes, certificateMessage } from "../src/features/fiscal/outgoing-nfe-model.ts"

const draft = { id: "a", revision: 1, createdAt: "2026-11-08T12:00:00Z", productsTotal: "100.00", input: { model: 55, environment: "production", recipient: { legalName: "Cliente Ávila", taxId: "11222333000181" } } }
test("emissão substitui o rascunho sem duplicar e preserva destinatário", () => {
 const notes = mergeNotes([draft], [{ id: "a", status: "authorized", model: 55, environment: "production", number: 32, series: 1 }])
 assert.equal(notes.length, 1)
 assert.equal(notes[0].status, "authorized")
 assert.equal(notes[0].recipient, "Cliente Ávila")
 assert.equal(notes[0].number, 32)
})
test("filtros combinam situação, documento com máscara, número e período", () => {
 const notes = mergeNotes([draft], [{ id: "a", status: "rejected", number: 32, series: 1, model: 55, environment: "production" }])
 assert.equal(filterNotes(notes, { query: "11.222.333/0001-81", status: "rejected", from: "2026-11-08", to: "2026-11-08" }).length, 1)
 assert.equal(filterNotes(notes, { query: "32", status: "authorized" }).length, 0)
 assert.equal(filterNotes(notes, { query: "", from: "2026-11-09" }).length, 0)
})
test("certificado indisponível não é apresentado como ausente; divergência pede atualização", () => {
 assert.match(certificateMessage("unavailable", false), /cofre/i)
 assert.match(certificateMessage("active", true), /conectado/i)
 assert.match(certificateMessage("active", false), /diverg/i)
 assert.match(certificateMessage("expired", false), /vencido/i)
})


test("parcelas dividem centavos sem alterar o total da nota", async () => {
 const { generateInstallments } = await import("../src/features/fiscal/nfe-extras-model.ts")
 const installments = generateInstallments("100.00", 3, "2026-12-08", 30)
 assert.deepEqual(installments.map(item => item.amount), ["33.34", "33.33", "33.33"])
 assert.equal(installments[1].dueDate, "2027-01-07")
 assert.throws(() => generateInstallments("0.01", 2, "2026-12-08", 30))
})

test("exportação normaliza a conversão tributável e referências sem alterar a edição", async () => {
  const { blankDraft, submission } = await import("../src/features/fiscal/nfe-draft-model.ts")
  const draft = blankDraft()
  draft.exportation = { kind: "indirect", exitState: "SP", exportLocation: "Santos", dispatchLocation: null }
  Object.assign(draft.items[0], { code: "EXP-1", description: "Equipamento", unit: "UN", quantity: "2", unitPrice: "50", origin: 0, csosn: "300", pisCst: "08", cofinsCst: "08", cfop: "7501", ncm: "95069100", taxableUnit: "KG", taxableQuantity: "20,5", taxableUnitPrice: "4,8780487805", exportDetails: [{ drawbackNumber: null, exportRegistration: "", referencedAccessKey: "35261004252011000110550010000000011000000017", exportedQuantity: "2" }] })
  const before = structuredClone(draft)
  const saved = submission(draft)
  assert.equal(saved.items[0].taxableQuantity, "20.5000")
  assert.equal(saved.items[0].taxableUnitPrice, "4.8780487805")
  assert.equal(saved.items[0].exportDetails[0].exportedQuantity, "2.0000")
  assert.equal(saved.items[0].exportDetails[0].exportRegistration, "")
  assert.deepEqual(draft, before)
})

test("seguro e despesas entram no total e metadados sao normalizados sem alterar o rascunho", async () => {
 const { blankDraft, blankItem, invoiceTotal, submission } = await import("../src/features/fiscal/nfe-draft-model.ts")
 const draft = { ...blankDraft(), transport: { netWeight: "10,5" }, retentions: { pis: "1,25" }, items: [{ ...blankItem(), origin: 0, csosn: "102", code: "P1", description: "Produto", unit: "UN", quantity: "1", unitPrice: "100", insuranceAmount: "5", otherAmount: "2", freightAmount: "10", discountAmount: "3" }], freightMode: "0" }
 assert.equal(invoiceTotal(draft), "114.00")
 const result = submission(draft)
 assert.equal(result.items[0].insuranceAmount, "5.00")
 assert.equal(result.transport.netWeight, "10.500")
 assert.equal(result.retentions.pis, "1.25")
 assert.equal(draft.transport.netWeight, "10,5")
})
