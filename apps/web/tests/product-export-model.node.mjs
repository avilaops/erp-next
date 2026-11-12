import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../src/features/data/export/product-export-model.ts";

const header = "sku,name,unit,ncm,cest,base_price,status";

test("consulta de exportação conserva filtros e recusa valores fora do contrato", () => {
  assert.equal(typeof model.productExportQuery, "function");
  const url = new URL(model.productExportQuery("  A & B  ", "active"), "https://erp.local");
  assert.equal(url.pathname, "/api/erp/products/export");
  assert.equal(url.searchParams.get("q"), "A & B");
  assert.equal(url.searchParams.get("status"), "active");
  assert.equal(model.productExportQuery("", ""), "/api/erp/products/export");
  for (const args of [["x".repeat(161), ""], ["Nome\u0000produto", ""], ["", "invalid"]]) assert.throws(() => model.productExportQuery(...args));
});

test("arquivo CSV mantém conteúdo, acentos, aspas, códigos e preço originais", async () => {
  assert.equal(typeof model.readProductExport, "function");
  const csv = header + '\r\nLD-A1,"Árvore, ""academia""\nsegunda linha",UN,01010101,0012345,19419.84,active\r\nLD-A2,\'=SUM(A1:A2),UN,,,10.00,archived\r\n';
  const file = await model.readProductExport(new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } }));
  assert.equal(await file.blob.text(), csv);
  assert.equal(file.empty, false);
  assert.match(file.blob.type, /^text\/csv/);
});

test("resposta inválida ou erro não vira um CSV e cabeçalho sem produtos permanece válido", async () => {
  assert.equal(typeof model.readProductExport, "function");
  for (const response of [Response.json({ data: [] }), new Response("<html>Entrar</html>", { headers: { "Content-Type": "text/html" } }), new Response("", { headers: { "Content-Type": "text/csv" } }), new Response("outro,cabecalho\r\n", { headers: { "Content-Type": "text/csv" } })]) await assert.rejects(() => model.readProductExport(response), /CSV/);
  await assert.rejects(() => model.readProductExport(Response.json({ title: "Sem permissão para exportar" }, { status: 403 })), /Sem permissão para exportar/);
  const empty = await model.readProductExport(new Response(header + "\r\n", { headers: { "Content-Type": "text/csv" } }));
  assert.equal(empty.empty, true);
  assert.equal(await empty.blob.text(), header + "\r\n");
});
