import assert from "node:assert/strict"
import { test } from "node:test"
import { listNavigationHref } from "../src/lib/list-navigation.ts"

const query = "offset=25&limit=25&sortBy=amount&sortOrder=desc&source=business"
const paramsOf = href => new URL(href, "https://erp.local").searchParams

test("purchase receiving alias survives list, order detail, editor, save redirect and back", () => {
  const list = "/compras/recebimentos"
  const detail = listNavigationHref("/compras/pedidos/order-id", list, query)
  assert.equal(paramsOf(detail).get("returnTo"), `${list}?${query}`)
  const editor = listNavigationHref("/compras/pedidos/order-id/editar", "/compras/pedidos/order-id", paramsOf(detail).toString())
  assert.equal(paramsOf(editor).get("returnTo"), `${list}?${query}`)
  const saved = listNavigationHref("/compras/pedidos/order-id", "/compras/pedidos/order-id/editar", paramsOf(editor).toString())
  assert.equal(paramsOf(saved).get("returnTo"), `${list}?${query}`)
  assert.equal(listNavigationHref("/compras/pedidos", "/compras/pedidos/order-id", paramsOf(saved).toString()), `${list}?${query}`)
})

test("ordinary list families preserve context through saved records and fragments", () => {
  for (const list of ["/compras/pedidos", "/vendas/pedidos", "/vendas/propostas", "/cadastros/produtos", "/financeiro/contas-receber"]) {
    const created = listNavigationHref(`${list}/id#details`, `${list}/novo`, new URLSearchParams({ returnTo: `${list}?${query}` }).toString())
    assert.equal(paramsOf(created).get("returnTo"), `${list}?${query}`)
    assert.ok(created.endsWith("#details"))
    assert.equal(listNavigationHref(`${list}#table`, `${list}/id`, paramsOf(created).toString()), `${list}?${query}#table`)
  }
})

test("purchase family mapping leaves explicit sibling list navigation and unrelated destinations alone", () => {
  assert.equal(listNavigationHref("/compras/recebimentos", "/compras/pedidos", query), "/compras/recebimentos")
  assert.equal(listNavigationHref("/preferencias", "/compras/recebimentos", query), "/preferencias")
  assert.equal(listNavigationHref("/financeiro/contas-pagar/id", "/compras/recebimentos", query), "/financeiro/contas-pagar/id")
})

test("return context rejects external origins, spoofed prefixes and unrelated list families", () => {
  const path = "/compras/pedidos/id"
  for (const previous of ["https://erp.local/compras/pedidos?sortBy=amount", "https://evil.test/compras/recebimentos?sortBy=amount", "//evil.test/compras/pedidos?sortBy=amount", "/compras/pedidos-evil?sortBy=amount", "/compras/pedidos/other?sortBy=amount", "/vendas/pedidos?sortBy=amount", "/\\evil.test/compras/pedidos?sortBy=amount"]) {
    assert.equal(listNavigationHref("/compras/pedidos", path, new URLSearchParams({ returnTo: previous }).toString()), "/compras/pedidos")
  }
  for (const href of ["https://evil.test/compras/pedidos/id", "//evil.test/compras/pedidos/id", "/\\evil.test/compras/pedidos/id", "/compras/pedidos-evil/id"]) assert.equal(listNavigationHref(href, "/compras/recebimentos", query), href)
})

test("POS history uses its exact sibling closing record while preserving the selected cash session", () => {
  const list = "/vendas/pdv/historico"
  const search = "offset=20&register=Principal&sessionsSortBy=openedAt&sessionsSortOrder=desc&salesOffset=20"
  const closing = listNavigationHref("/vendas/pdv/fechamento?caixa=session-id", list, search)
  assert.equal(paramsOf(closing).get("caixa"), "session-id")
  assert.equal(paramsOf(closing).get("returnTo"), `${list}?${search}`)
  assert.equal(listNavigationHref(list, "/vendas/pdv/fechamento", paramsOf(closing).toString()), `${list}?${search}`)
  for (const target of ["/vendas/pdv", "/vendas/pdv/sale-id", "/vendas/pdv/fechamento/other", "/vendas/pdv/historico/other", "/vendas/pedidos/id"]) assert.equal(listNavigationHref(target, list, search), target)
  assert.equal(listNavigationHref(list, "/vendas/pdv", new URLSearchParams({ returnTo: `${list}?${search}` }).toString()), list)
})
