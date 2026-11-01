import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHandler } from "../src/server.ts";

test("health check requires bearer and returns homologation readiness without fiscal credentials", async () => {
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
    assert.deepEqual(await response.json(), { status: "ok", environment: "homologation" });
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: "Bearer test-token-with-enough-entropy" } })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
