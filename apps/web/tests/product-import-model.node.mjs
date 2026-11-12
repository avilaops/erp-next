import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../src/features/data/import/product-import-model.ts";

const id = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const rows = [{ line: 2, input: { sku: "A", name: "Árvore" }, error: null, conflict: false }, { line: 3, input: { sku: "B", name: "Inválido" }, error: "Unidade inválida", conflict: false }, { line: 4, input: { sku: "C", name: "Existente" }, error: null, conflict: true }];
const preview = { id, filename: "produtos.csv", format: "csv", status: "previewed", valid: 1, invalid: 1, conflicts: 1, rows, result: null };
test("URL de recuperação usa apenas o UUID do resultado", () => {
  assert.equal(typeof model.productImportHref, "function");
  assert.equal(model.productImportHref(id), "/preferencias/dados/importacao?job=" + id);
  assert.equal(model.productImportHref(id, true), "/preferencias/dados/importacao?job=" + id + "&pending=1");
  for (const bad of ["", "../x", id + "&tenantId=x"]) assert.throws(() => model.productImportHref(bad));
});
test("leitura do CSV conserva bytes UTF-8 e recusa arquivo inadequado antes de enviar", async () => {
  assert.equal(typeof model.readProductImportFile, "function");
  const content = 'sku,name,unit\r\nA,"Árvore, academia",UN\r\n';
  assert.deepEqual(await model.readProductImportFile(new File([content], "academia.CSV")), { filename: "academia.CSV", content });
  for (const file of [new File(["x"], "x.xlsx"), new File([], "vazio.csv"), new File([new Uint8Array(2097153)], "grande.csv"), new File([new Uint8Array([255])], "utf8.csv"), new File(["x"], "á".repeat(80) + ".csv")]) await assert.rejects(() => model.readProductImportFile(file), /CSV|UTF-8|nome/i);
});
test("prévia conserva linhas e contadores reais, resultado parcial fica explícito", async () => {
  assert.equal(typeof model.readProductImport, "function");
  assert.deepEqual(await model.readProductImport(Response.json({ data: preview }), id), preview);
  const imported = { ...preview, status: "imported", result: { imported: 1, total: 3 } };
  assert.deepEqual(await model.readProductImport(Response.json({ data: imported }), id), imported);
});
test("resposta incompleta, contagem inventada e ID divergente nunca viram confirmação", async () => {
  assert.equal(typeof model.readProductImport, "function");
  for (const data of [{}, { ...preview, valid: 50 }, { ...preview, id: other }, { ...preview, status: "done" }, { ...preview, status: "imported", result: null }, { ...preview, status: "imported", result: { imported: 4, total: 3 } }, { ...preview, rows: [{ ...rows[0], input: null }] }]) await assert.rejects(() => model.readProductImport(Response.json({ data }), id), /resultado|prévia/i);
  await assert.rejects(() => model.readProductImport(new Response("<html>Entrar</html>")), /resultado|prévia/i);
  await assert.rejects(() => model.readProductImport(Response.json({ title: "Sem permissão de importação" }, { status: 403 })), /Sem permissão/);
});
