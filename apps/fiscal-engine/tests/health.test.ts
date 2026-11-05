import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/server.ts";

const run = promisify(execFile);
const healthcheck = fileURLToPath(new URL("../scripts/healthcheck.mjs", import.meta.url));
const token = "test-token-with-enough-entropy";

async function probe(port: number, bearer = token) {
  return run(process.execPath, [healthcheck], {
    env: { ...process.env, FISCAL_ENGINE_PORT: String(port), ERP_FISCAL_ENGINE_TOKEN: bearer },
    timeout: 5000,
  });
}

function failedWithoutOutput(error: unknown) {
  const result = error as { code?: number; stdout?: string; stderr?: string };
  return result.code === 1 && result.stdout === "" && result.stderr === "";
}

test("health check requires bearer and reports supported environments without fiscal credentials", async () => {
  const server = createServer(createHandler("test-token-with-enough-entropy"));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/healthz`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer incorrect" } })).status, 401);
    const response = await fetch(url, { headers: { authorization: "Bearer test-token-with-enough-entropy" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ok", environments: ["homologation", "production"] });
    assert.deepEqual(await probe(address.port), { stdout: "", stderr: "" });
    await assert.rejects(probe(address.port, "incorrect-token-with-enough-entropy"), failedWithoutOutput);
    await assert.rejects(probe(address.port, ""), failedWithoutOutput);
    await assert.rejects(probe(0), failedWithoutOutput);
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: "Bearer test-token-with-enough-entropy" } })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("deployment probe rejects unsuccessful responses and incomplete capabilities", async () => {
  const responses = [
    { status: 503, body: { status: "ok", environments: ["homologation", "production"] } },
    { status: 200, body: { status: "blocked", environments: ["homologation", "production"] } },
    { status: 200, body: { status: "ok", environment: "homologation" } },
    { status: 200, body: { status: "ok", environments: ["homologation"] } },
    { status: 200, body: { status: "ok", environments: "homologation,production" } },
    { status: 200, body: null },
    { status: 200, body: "invalid JSON" },
  ];
  for (const fixture of responses) {
    const server = createServer((request, response) => {
      assert.equal(request.url, "/healthz");
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      response.writeHead(fixture.status, { "Content-Type": "application/json" });
      response.end(typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body));
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    try { await assert.rejects(probe(address.port), failedWithoutOutput); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }
});
