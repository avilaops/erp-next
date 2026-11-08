import test from "node:test"
import assert from "node:assert/strict"
import { staffAssignment } from "../src/features/staff/staff-assignment.ts"

test("o cargo identifica a atuação em vendas sem criar outro cadastro", () => {
  for (const cargo of ["Vendedor", "vendedora", " VENDEDOR EXTERNO "]) assert.deepEqual(staffAssignment(cargo), { isEmployee: true, isSeller: true })
  for (const cargo of [null, "", "Financeiro", "Comprador"]) assert.deepEqual(staffAssignment(cargo), { isEmployee: true, isSeller: false })
})

test("editar contatos preserva atuação comercial legada até alterar o cargo", () => {
  const previous = { jobTitle: "Consultor comercial", isSeller: true }
  assert.deepEqual(staffAssignment("Consultor comercial", previous), { isEmployee: true, isSeller: true })
  assert.deepEqual(staffAssignment("Financeiro", previous), { isEmployee: true, isSeller: false })
})

test("editar um vendedor externo não muda seu vínculo para funcionário", () => {
  assert.deepEqual(staffAssignment("Vendedor", { jobTitle: "Vendedor", isSeller: true, isEmployee: false }), { isEmployee: false, isSeller: true })
})
