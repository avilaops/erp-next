import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const uri = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const session = uri('export const currentSession=async()=>globalThis.__productExportSession;export const currentIdentitySession=currentSession;export const erpConfiguration=()=>({origin:"http://fixture.local",api:"http://backend.local"});');
const source = readFileSync(new URL("../src/server/bff/erp-proxy.ts", import.meta.url), "utf8").replace('import "server-only"', "").replace('"@/server/auth/erp-session"', JSON.stringify(session)).replace('"@/lib/api/local-fiscal-origin"', JSON.stringify(new URL("../src/lib/api/local-fiscal-origin.ts", import.meta.url).href));
const { forwardErp } = await import(uri(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText));

test("exportação BFF usa empresa da sessão e conserva filtros, CSV e nome do arquivo", async () => {
  const previous = globalThis.fetch;
  globalThis.__productExportSession = { tenantId: tenant, accessToken: "fixture" };
  const calls = [];
  const csv = "sku,name,unit,ncm,cest,base_price,status\r\nA,Academia,UN,01010101,,10.00,active\r\n";
  globalThis.fetch = async (url, init) => { calls.push({ url: new URL(url), init }); return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=produtos.csv" } }); };
  try {
    const response = await forwardErp(new Request("http://fixture.local/export?q=Academia&status=active", { headers: { "X-Tenant-Id": other } }), "/products/export");
    assert.equal(response.status, 200);
    assert.equal(calls[0].init.headers.get("x-tenant-id"), tenant);
    assert.equal(calls[0].init.headers.get("accept"), "text/csv");
    assert.equal(calls[0].url.searchParams.get("q"), "Academia");
    assert.equal(calls[0].url.searchParams.get("status"), "active");
    assert.equal(response.headers.get("content-disposition"), "attachment; filename=produtos.csv");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(await response.text(), csv);
  } finally { globalThis.fetch = previous; delete globalThis.__productExportSession; }
});

test("exportação BFF recusa sessão ausente, método inválido e filtros de outra empresa", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Unexpected upstream request"); };
  try {
    globalThis.__productExportSession = null;
    assert.equal((await forwardErp(new Request("http://fixture.local/export"), "/products/export")).status, 401);
    globalThis.__productExportSession = { tenantId: tenant, accessToken: "fixture" };
    assert.equal((await forwardErp(new Request("http://fixture.local/export?tenantId=" + other), "/products/export")).status, 400);
    assert.equal((await forwardErp(new Request("http://fixture.local/export?q=a&q=b"), "/products/export")).status, 400);
    assert.equal((await forwardErp(new Request("http://fixture.local/export", { method: "POST", headers: { origin: "http://fixture.local", "content-type": "application/json", "x-tenant-id": tenant }, body: "{}" }), "/products/export")).status, 405);
  } finally { globalThis.fetch = previous; delete globalThis.__productExportSession; }
});

test("cancelamento da exportação interrompe também o sinal da consulta upstream", async () => {
  const previous = globalThis.fetch;
  globalThis.__productExportSession = { tenantId: tenant, accessToken: "fixture" };
  const controller = new AbortController();
  let entered, finish, upstreamSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const completed = new Promise(resolve => { finish = resolve; });
  globalThis.fetch = async (_url, init) => { upstreamSignal = init.signal; entered(); await completed; return new Response("sku,name,unit,ncm,cest,base_price,status\r\n", { headers: { "Content-Type": "text/csv" } }); };
  const pending = forwardErp(new Request("http://fixture.local/export", { signal: controller.signal }), "/products/export");
  try {
    await started;
    assert.equal(upstreamSignal.aborted, false);
    controller.abort();
    assert.equal(upstreamSignal.aborted, true, "Aborting the browser request must also abort the upstream export");
  } finally { finish(); await pending; globalThis.fetch = previous; delete globalThis.__productExportSession; }
});
