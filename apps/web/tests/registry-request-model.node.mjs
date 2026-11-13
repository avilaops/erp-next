import assert from "node:assert/strict";
import { test } from "node:test";
import { requestRegistryLookup, requestRegistrySession } from "../src/features/records/registry-request.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const input = { kind: "cnpj", context: "party", value: "04252011000110" };
const found = { tenantId: tenant, kind: "cnpj", value: input.value, status: "found", source: "BrasilAPI", sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), cached: false, attempts: [], warnings: [], data: { fields: { legalName: "Empresa da fonte" }, stateRegistrations: [], taxpayerStatus: "unknown", genericPostalCode: false } };

test("an empty lookup response is recovered once with the same read-only request", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? new Response("") : Response.json(found); };
  const result = await requestRegistryLookup(input, tenant, new AbortController().signal, fetcher);
  assert.deepEqual(result, found);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/erp/registry-lookups");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Tenant-Id"], tenant);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test("session verification also recovers an empty response before returning a tenant", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? new Response("") : Response.json({ tenant: { id: tenant }, permissions: [] }); };
  const result = await requestRegistrySession(new AbortController().signal, fetcher);
  assert.equal(result.tenant.id, tenant);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === "/api/erp/me" && (!call.init.method || call.init.method === "GET")));
});

test("persistent empty, truncated, HTML or incomplete replies stop after two attempts with a usable message", async () => {
  for (const body of ["", "{", "<html>bad gateway</html>", "null", "[]", "{}", '{"status":"found"}']) {
    let calls = 0;
    await assert.rejects(requestRegistryLookup(input, tenant, new AbortController().signal, async () => { calls++; return new Response(body); }), error => {
      assert.match(error.message, /consulta|resposta|indisponível/i);
      assert.doesNotMatch(error.message, /JSON|Unexpected|SyntaxError|<html>/i);
      return true;
    });
    assert.equal(calls, 2);
  }
});

test("explicit authorization, tenant and validation refusals are never retried even without a body", async () => {
  for (const status of [401, 403, 409, 422, 429]) {
    let calls = 0;
    await assert.rejects(requestRegistryLookup(input, tenant, new AbortController().signal, async () => { calls++; return new Response("", { status }); }));
    assert.equal(calls, 1, `status ${status}`);
  }
});

test("a temporary gateway error recovers once but a valid unavailable reply respects the provider warning", async () => {
  let calls = 0;
  const recovered = await requestRegistryLookup(input, tenant, new AbortController().signal, async () => ++calls === 1 ? Response.json({ title: "Consulta indisponível" }, { status: 502 }) : Response.json(found));
  assert.equal(recovered.status, "found"); assert.equal(calls, 2);
  calls = 0;
  const unavailable = { ...found, status: "unavailable", data: null, source: null, expiresAt: null, warnings: ["Limite de consultas atingido"] };
  assert.deepEqual(await requestRegistryLookup(input, tenant, new AbortController().signal, async () => { calls++; return Response.json(unavailable); }), unavailable);
  assert.equal(calls, 1);
});

test("cancellation prevents a retry and no successful lookup substitutes for failed session verification", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(requestRegistryLookup(input, tenant, controller.signal, async () => { calls++; controller.abort(); return new Response(""); }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(requestRegistrySession(new AbortController().signal, async () => { calls++; return Response.json({ tenant: { id: "" } }); }));
  assert.equal(calls, 2);
});

test("partially complete previews cannot reach the renderer or autofill", async () => {
  const replies = [
    { ...found, data: { fields: { legalName: "Incomplete" } } },
    { ...found, data: { ...found.data, stateRegistrations: null } },
    { ...found, data: { ...found.data, stateRegistrations: [null] } },
    { ...found, data: { ...found.data, stateRegistrations: [{ state: {}, number: "123" }] } },
    { ...found, data: { ...found.data, stateRegistrations: [{ state: "SP", number: {} }] } },
    { ...found, source: {} }, { ...found, sourceUpdatedAt: {} }, { ...found, fetchedAt: {} }, { ...found, expiresAt: {} },
  ];
  for (const reply of replies) {
    let calls = 0;
    await assert.rejects(requestRegistryLookup(input, tenant, new AbortController().signal, async () => { calls++; return Response.json(reply); }), /Consulta indisponível/);
    assert.equal(calls, 2);
  }
});
