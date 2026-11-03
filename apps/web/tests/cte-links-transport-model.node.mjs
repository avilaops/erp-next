import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Load the real TypeScript client and its real erpFetch boundary; only HTTP is doubled.
const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const sourceRoot = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/api/client") return { url: new URL("../src/lib/api/client.ts", import.meta.url).href, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot) && !/\.[cm]?[jt]s$/.test(specifier)) return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith(".ts")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const { sendCteLinkCommand } = await import("../src/features/fiscal/cte-links.ts");
const facts = JSON.parse(readFileSync(new URL("../../api/src/http/fixtures/cte-received-inspection.json", import.meta.url), "utf8"));
const tenant = "11111111-1111-4111-8111-111111111111", documentId = "22222222-2222-4222-8222-222222222222", inspectionId = "44444444-4444-4444-8444-444444444444", carrier = "55555555-5555-4555-8555-555555555555", order = "66666666-6666-4666-8666-666666666666";
const permissions = ["fiscal.cte.read", "fiscal.cte.link", "catalog.parties.read", "purchasing.orders.read"];
const current = { id: tenant, legalName: "Empresa sintética", subject: "editor", permissions };
const inspected = { tenantId: tenant, documentId, sourceXmlSha256: facts.xmlSha256, canInspect: true, data: { id: inspectionId, documentId, sourceXmlSha256: facts.xmlSha256, inspectorVersion: "cte-received-v1", document: facts, createdAt: "2026-11-03T15:00:00Z" } };
const result = { tenantId: tenant, documentId, inspectionId, sourceXmlSha256: facts.xmlSha256, revision: 2, serviceCents: "15001", allocatedCents: "15001", canLinkPurchase: true, canLinkSale: false, carrier: { partyId: carrier, taxId: facts.carrier.value, name: "Transportadora", ownCompany: false, available: true }, data: [{ id: "77777777-7777-4777-8777-777777777777", kind: "purchase", orderId: order, carrierPartyId: carrier, carrierTaxId: facts.carrier.value, carrierName: "Transportadora", counterpartyName: "Fornecedor", orderAmountCents: "50000", orderRevision: 1, freightCents: "15001", reason: "Conferi o pedido", createdAt: "2026-11-03T15:00:00Z", canUnlink: true, restricted: false }] };
const input = { kind: "purchase", orderId: order, carrierPartyId: carrier, freightCents: "15001", reason: "Conferi o pedido" };
const command = Object.freeze({ action: "link", kind: "purchase", input, tenantId: tenant, subject: "editor", documentId, hash: facts.xmlSha256, revision: 1, key: "88888888-8888-4888-8888-888888888888", body: JSON.stringify(input) });

test("CT-e write carries an expected actor precondition without choosing the server's executing identity", async t => {
  let headers;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, `/api/erp/fiscal/cte-distribution/documents/${documentId}/commercial-links`);
    headers = new Headers(init.headers);
    return Response.json(result, { status: 201 });
  });
  for (const [subject, expected] of [["editor", "ZWRpdG9y"], ["usuário", "dXN1w6FyaW8"]]) {
    await sendCteLinkCommand(inspected, async () => ({ ...current, subject }), new AbortController().signal, { ...command, subject });
    assert.equal(headers.get("x-actor-subject"), expected);
  }
});

test("CT-e temporary access verification failure after POST preserves an uncertain command for exact retry", async t => {
  const writes = [];
  t.mock.method(globalThis, "fetch", async (_path, init) => { writes.push({ headers: new Headers(init.headers), body: init.body }); return Response.json(result, { status: writes.length === 1 ? 201 : 200 }); });
  let checks = 0;
  await assert.rejects(() => sendCteLinkCommand(inspected, async () => { if (++checks === 2) throw new Error("Acesso temporariamente indisponível"); return current; }, new AbortController().signal, command), error => {
    assert.equal(error.contextInvalid, false);
    assert.equal(error.status, 503);
    return true;
  });
  const recovered = await sendCteLinkCommand(inspected, async () => current, new AbortController().signal, command);
  assert.equal(recovered.allocatedCents, "15001");
  assert.equal(writes.length, 2);
  assert.equal(writes[1].body, writes[0].body);
  assert.equal(writes[1].headers.get("idempotency-key"), "88888888-8888-4888-8888-888888888888");
  assert.equal(writes[1].headers.get("if-match"), '"1"');
});

test("CT-e a proven actor change after POST remains a context failure and never publishes old details", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(result, { status: 201 }));
  let checks = 0;
  await assert.rejects(() => sendCteLinkCommand(inspected, async () => ({ ...current, subject: ++checks === 1 ? "editor" : "reader" }), new AbortController().signal, command), error => { assert.equal(error.contextInvalid, true); return true; });
});
