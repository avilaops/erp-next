import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const tenant = "11111111-1111-4111-8111-111111111111";
const version = "55555555-5555-4555-8555-555555555555";
const sessionModule = "data:text/javascript;base64," + Buffer.from(`
export const currentSession = async () => ({tenantId:"${tenant}",accessToken:"fixture-only"});
export const currentIdentitySession = currentSession;
export const erpConfiguration = () => ({origin:"http://fixture.local",api:"http://backend.local"});
`).toString("base64");
const source = readFileSync(new URL("../src/server/bff/erp-proxy.ts", import.meta.url), "utf8")
  .replace('import "server-only"', "")
  .replace('"@/server/auth/erp-session"', JSON.stringify(sessionModule));
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { forwardErp } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("simulator BFF forwards historical version, tenant, revision and idempotency with no-store", async () => {
  const previous = globalThis.fetch;
  const received = [];
  globalThis.fetch = async (url, options) => { received.push({ url: String(url), ...options }); return Response.json({ ok: true }, { headers: { ETag: '"2"' } }); };
  try {
    const result = await forwardErp(new Request(`http://fixture.local/api/erp/sales-simulator/imported?versionId=${version}`), "/sales-simulator/imported");
    assert.equal(result.status, 200);
    assert.equal(received[0].url, `http://backend.local/api/v1/sales-simulator/imported?versionId=${version}`);
    assert.equal(received[0].headers.get("x-tenant-id"), tenant);
    assert.equal(received[0].cache, "no-store");
    assert.equal(result.headers.get("etag"), '"2"');
    const approval = new Request("http://fixture.local/approval", { method: "POST", headers: { origin: "http://fixture.local", "x-tenant-id": tenant, "content-type": "application/json", "if-match": '"1"', "idempotency-key": version }, body: JSON.stringify({ reason: "Negociação revisada" }) });
    assert.equal((await forwardErp(approval, `/orders/${version}/pricing/approve`)).status, 200);
    assert.equal(received[1].headers.get("if-match"), '"1"');
    assert.equal(received[1].headers.get("idempotency-key"), version);
  } finally { globalThis.fetch = previous; }
});

test("simulator BFF rejects unknown resources, duplicate filters, foreign tenant and origin before upstream", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Unexpected upstream access"); };
  try {
    for (const query of ["?unapproved=1", "?versionId=bad", `?versionId=${version}&versionId=${version}`]) {
      assert.equal((await forwardErp(new Request("http://fixture.local/query" + query), "/sales-simulator/imported")).status, 400);
    }
    assert.equal((await forwardErp(new Request("http://fixture.local/query"), "/sales-simulator/other")).status, 400);
    for (const headers of [
      { origin: "http://foreign.local", "x-tenant-id": tenant },
      { origin: "http://fixture.local", "x-tenant-id": version },
    ]) {
      const request = new Request("http://fixture.local/quote", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
      assert.ok([403,409].includes((await forwardErp(request, "/sales-simulator/imported/quote")).status));
    }
  } finally { globalThis.fetch = previous; }
});
