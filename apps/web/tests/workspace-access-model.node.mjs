import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function fixtureFor(identity, configured = true, loginConfigured = true) {
  const moduleUrl = "data:text/javascript;base64," + Buffer.from(`
    // ${crypto.randomUUID()}
    let release, reject;
    const request = new Promise((resolve, fail) => { release = resolve; reject = fail });
    export const fixture = { configured: false, configurationReads: 0, identityReads: 0 };
    export const connection = () => request;
    export const acceptRequest = () => { fixture.configured = ${configured}; release() };
    export const rejectRequest = error => reject(error);
    export const erpConfiguration = () => {
      fixture.configurationReads++;
      if (!fixture.configured) throw Error("Configuration unavailable");
      return ${JSON.stringify(loginConfigured ? { clientId: "fixture", clientSecret: "fixture" } : {})};
    };
    export const currentIdentitySession = async () => { fixture.identityReads++; return ${JSON.stringify(identity)} };
    export default function Link() {}
    export function AccessLink() {}
  `).toString("base64");
  const source = readFileSync(new URL("../src/features/access/workspace-access.tsx", import.meta.url), "utf8")
    .replace('"next/link"', JSON.stringify(moduleUrl))
    .replace('"next/server"', JSON.stringify(moduleUrl))
    .replace('"../../components/feedback/session-recovery"', JSON.stringify(moduleUrl))
    .replace('"@/server/auth/erp-session"', JSON.stringify(moduleUrl));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const access = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
  return { ...await import(moduleUrl), ...access };
}

test("workspace configuration waits for the request instead of freezing build-time access", async () => {
  const identity = { accessToken: "fixture", tenantId: "11111111-1111-4111-8111-111111111111", expiresAt: 123 };
  const fixture = await fixtureFor(identity);
  const pending = fixture.currentWorkspaceAccess();
  await Promise.resolve();
  assert.equal(fixture.fixture.configurationReads, 0);
  assert.equal(fixture.fixture.identityReads, 0);
  fixture.acceptRequest();
  assert.deepEqual(await pending, { state: "ready", session: identity });
});

test("request-time access preserves configuration, login and company requirements", async () => {
  for (const [identity, configured, loginConfigured, state] of [
    [null, false, true, "configuration"],
    [null, true, true, "login"],
    [null, true, false, "configuration"],
    [{ accessToken: "fixture", tenantId: null }, true, true, "company"],
  ]) {
    const fixture = await fixtureFor(identity, configured, loginConfigured);
    const pending = fixture.currentWorkspaceAccess();
    fixture.acceptRequest();
    assert.deepEqual(await pending, { state, session: null });
  }
});

test("a prerender interruption is propagated instead of becoming a configuration notice", async () => {
  const fixture = await fixtureFor(null);
  const pending = fixture.currentWorkspaceAccess();
  const interruption = new Error("Wait for a request");
  fixture.rejectRequest(interruption);
  await assert.rejects(pending, error => error === interruption);
  assert.equal(fixture.fixture.configurationReads, 0);
});
