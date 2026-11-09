import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const tenant = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
const resource = `/products/${product}/catalog`;
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const session = moduleUrl(`export const currentSession = async () => ({tenantId:"${tenant}",accessToken:"fixture"}); export const currentIdentitySession = currentSession; export const erpConfiguration = () => ({origin:"http://fixture.local",api:"http://backend.local"});`);
const source = readFileSync(new URL("../src/server/bff/erp-proxy.ts", import.meta.url), "utf8")
  .replace('import "server-only"', "")
  .replace('"@/server/auth/erp-session"', JSON.stringify(session))
  .replace('"@/lib/api/local-fiscal-origin"', JSON.stringify(new URL("../src/lib/api/local-fiscal-origin.ts", import.meta.url).href));
const { forwardErp } = await import(moduleUrl(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText));

test("product catalog GET and revised PUT reach the existing API route", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ tenantId: tenant }, { headers: { etag: '"4"' } }); };
  try {
    const response = await forwardErp(new Request("http://fixture.local/detail"), resource);
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, `http://backend.local/api/v1${resource}`);
    assert.equal(calls[0].options.headers.get("x-tenant-id"), tenant);
    assert.equal(response.headers.get("etag"), '"4"');
    const update = new Request("http://fixture.local/detail", { method: "PUT", headers: { origin: "http://fixture.local", "x-tenant-id": tenant, "content-type": "application/json", "if-match": '"3"' }, body: JSON.stringify({ description: "Apresentação", newImage: "A".repeat(70000) }) });
    assert.equal((await forwardErp(update, resource)).status, 200);
    assert.equal(calls[1].options.headers.get("if-match"), '"3"');
    assert.equal(calls[1].options.method, "PUT");
  } finally { globalThis.fetch = previous; }
});

test("catalog routing keeps method, path, origin and tenant restrictions", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Unexpected upstream"); };
  const update = headers => new Request("http://fixture.local/detail", { method: "PUT", headers: { origin: "http://fixture.local", "x-tenant-id": tenant, "content-type": "application/json", ...headers }, body: "{}" });
  try {
    assert.equal((await forwardErp(new Request("http://fixture.local/detail", { method: "POST" }), resource)).status, 400);
    assert.equal((await forwardErp(new Request("http://fixture.local/detail"), "/products/not-a-uuid/catalog")).status, 400);
    assert.equal((await forwardErp(update({ origin: "http://foreign.local" }), resource)).status, 403);
    assert.equal((await forwardErp(update({ "x-tenant-id": product }), resource)).status, 409);
  } finally { globalThis.fetch = previous; }
});
