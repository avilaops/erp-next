import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
async function proxyFor(tenantId) {
  const identity = { tenantId, accessToken: "fixture-only" };
  const sessionModule = "data:text/javascript;base64," + Buffer.from(`
    export const currentIdentitySession = async () => (${JSON.stringify(identity)});
    export const currentSession = async () => (${JSON.stringify(tenantId ? identity : null)});
    export const erpConfiguration = () => ({origin:"http://fixture.local",api:"http://backend.local"});
  `).toString("base64");
  const fiscalSource = readFileSync(new URL("../src/lib/api/local-fiscal-origin.ts", import.meta.url), "utf8");
  const fiscalModule = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(fiscalSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64");
  const source = readFileSync(new URL("../src/server/bff/erp-proxy.ts", import.meta.url), "utf8")
    .replace('import "server-only"', "")
    .replace('"@/lib/api/local-fiscal-origin"', JSON.stringify(fiscalModule))
    .replace('"@/server/auth/erp-session"', JSON.stringify(sessionModule));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return (await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"))).forwardErp;
}
const request = tenantId => new Request("http://fixture.local/api/erp/registry-lookups", {
  method: "POST",
  headers: { origin: "http://fixture.local", "content-type": "application/json", ...(tenantId ? { "x-tenant-id": tenantId } : {}) },
  body: JSON.stringify({ kind: "cep", value: "01001000", context: "company" }),
});

test("commercial table forwards only a single destination and contributor filter", async () => {
  const forward = await proxyFor(tenant);
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ tenantId: tenant }); };
  const table = query => new Request(`http://fixture.local/api/erp/commercial/tables/imported${query}`);
  try {
    assert.equal((await forward(table("?destinationState=MG&taxpayer=true"), "/commercial/tables/imported")).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).search, "?destinationState=MG&taxpayer=true");
    assert.equal(calls[0].options.headers.get("x-tenant-id"), tenant);
    for (const query of ["?destinationState=MG&destinationState=SP", "?taxpayer=yes", "?destinationState=mg", "?override=director"]) {
      assert.equal((await forward(table(query), "/commercial/tables/imported")).status, 400, query);
    }
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("company logo fits the bounded company body without increasing other resources", async () => {
  const forward = await proxyFor(tenant);
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ tenantId: tenant }); };
  const update = size => new Request("http://fixture.local/api/erp/company", {
    method: "PUT", headers: { origin: "http://fixture.local", "content-type": "application/json", "x-tenant-id": tenant, "if-match": '"3"' },
    body: JSON.stringify({ logoDataUrl: "data:image/png;base64," + "A".repeat(size) }),
  });
  try {
    assert.equal((await forward(update(349000), "/company")).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.get("if-match"), '"3"');
    assert.equal(calls[0].options.headers.get("x-tenant-id"), tenant);
    assert.equal((await forward(update(400000), "/company")).status, 413);
    assert.equal((await forward(update(70000), "/parties")).status, 413);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("registry lookups reject missing or foreign tenant before contacting upstream", async () => {
  const forward = await proxyFor(tenant);
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ tenantId: tenant }); };
  try {
    assert.equal((await forward(request(other), "/registry-lookups")).status, 409);
    assert.equal((await forward(request(null), "/registry-lookups")).status, 409);
    assert.equal(calls.length, 0);
    assert.equal((await forward(request(tenant), "/registry-lookups")).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.get("x-tenant-id"), tenant);
  } finally { globalThis.fetch = previous; }
});

test("identity-only access is limited to the company registration lookup", async () => {
  const forward = await proxyFor(null);
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ status: "found" }); };
  try {
    assert.equal((await forward(request(other), "/registry-lookups")).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await forward(request(null), "/company-registration/lookup")).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.has("x-tenant-id"), false);
  } finally { globalThis.fetch = previous; }
});
