import assert from "node:assert/strict"
import test from "node:test"
import * as fields from "../src/features/contracts/contract-fields.ts"

const options = [
  { name: "choice-a", type: "text", required: false, choiceGroup: "Origem", choiceOption: "Nacional" },
  { name: "choice-b", type: "text", required: false, choiceGroup: "Origem", choiceOption: "Importado" },
]

test("choosing one option atomically clears every other mark and preserves unrelated fields", () => {
  const value = fields.contractChooseGroup?.(options, "choice-b", {}, { "choice-a": "X", "choice-b": "X", note: "Preservado" })
  assert.deepEqual(value, { "choice-a": "", "choice-b": "X", note: "Preservado" })
})

test("optional groups can be cleared without changing authoritative empty defaults", () => {
  const value = fields.contractChooseGroup?.(options, "", { "choice-a": "" }, { "choice-b": "X", note: "Preservado" })
  assert.deepEqual(value, { "choice-b": "", note: "Preservado" })
  assert.deepEqual(fields.contractChooseGroup?.(options, "choice-a", { "choice-a": "" }, { note: "Preservado" }), { note: "Preservado" })
  assert.equal(fields.contractFieldValue?.("choice-a", { "choice-a": "" }, { "choice-a": "X" }), "")
})

test("a choice fixed by the order cannot be replaced or cleared", () => {
  assert.deepEqual(fields.contractChooseGroup?.(options, "choice-b", { "choice-a": "X" }, { note: "Preservado" }), { note: "Preservado" })
  assert.deepEqual(fields.contractChooseGroup?.(options, "", { "choice-a": "X" }, { note: "Preservado" }), { note: "Preservado" })
  assert.deepEqual(fields.contractChooseGroup?.(options, "foreign", {}, { note: "Preservado" }), { note: "Preservado" })
})

test("choice units come only from server metadata and retain ordinary legacy fields", () => {
  const units = fields.contractFieldUnits?.([options[0], { name: "cliente_nome", type: "text", required: true }, options[1]])
  assert.deepEqual(units?.map(unit => [unit.kind, unit.name, unit.fields.length]), [["choice", "Origem", 2], ["field", "cliente_nome", 1]])
  assert.equal(fields.contractFieldUnits?.([{ name: "Pagamento — condição — À vista", type: "text", required: false }])?.[0].kind, "field")
})

test("only paragraph content uses multiline controls", () => {
  for (const name of ["itens", "condicoes", "entrega", "observacoes", "Produto 1 — descrição", "Técnica — OBSERVAÇÕES TÉCNICAS ADICIONAIS", "Reserva de domínio — individualização dos produtos"]) {
    assert.equal(fields.contractFieldIsMultiline?.(name), true, name)
  }
  for (const name of ["cliente_nome", "pedido_total", "Produto 1 — quantidade", "Data do contrato — dia", "Compradora — endereço — CEP", "Técnica — TENSÃO / FREQUÊNCIA"]) {
    assert.equal(fields.contractFieldIsMultiline?.(name), false, name)
  }
})
