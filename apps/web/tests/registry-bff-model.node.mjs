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

test("invalid registry bodies become JSON problems while authorization status and request ID survive", async () => {
  const forward = await proxyFor(tenant);
  const previous = globalThis.fetch;
  try {
    for (const status of [200, 204, 401, 403, 409, 422, 429, 502, 503, 504]) {
      for (const body of status === 204 ? [null] : ["", "{", "<html>gateway</html>", "null", "[]"]) {
        globalThis.fetch = async () => new Response(body, { status, headers: { "x-request-id": "fixture-request" } });
        const response = await forward(request(tenant), "/registry-lookups");
        assert.equal(response.status, status < 300 ? 502 : status);
        assert.equal(response.headers.get("x-request-id"), "fixture-request");
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.match(response.headers.get("content-type"), /application\/json/);
        assert.match((await response.json()).title, /Consulta cadastral indisponível/);
      }
    }
    globalThis.fetch = async () => new Response("", { status: 200 });
    const onboarding = await forward(request(null), "/company-registration/lookup");
    assert.equal(onboarding.status, 502);
    assert.match((await onboarding.json()).title, /Consulta cadastral indisponível/);
  } finally { globalThis.fetch = previous; }
});

test("registry recovery does not change bodyless responses of business commands", async () => {
  const forward = await proxyFor(tenant);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
  try {
    const response = await forward(request(tenant), "/orders");
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
