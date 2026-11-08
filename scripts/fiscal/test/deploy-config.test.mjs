import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("release dispatcher preserves private config and pins the restricted MCP runtime", () => {
  const dispatcher = readFileSync(new URL("../../../deploy/production-deploy.sh", import.meta.url), "utf8");
  const code = dispatcher.match(/python3 - "\$release\/compose.json" "\$source_sha" <<'PY'\r?\n([\s\S]*?)\r?\nPY/)[1];
  const directory = mkdtempSync(join(tmpdir(), "erp-deploy-config-"));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("erp-deploy-config-"));
  const file = join(directory, "compose.json");
  const sha = "a".repeat(40);
  const privateToken = "synthetic-private-fiscal-token-123456";
  try {
    writeFileSync(file, JSON.stringify({ services: {
      api: { environment: { ERP_FISCAL_ENGINE_TOKEN: privateToken } },
      web: { environment: { ERP_SESSION_SECRET: "synthetic-original-session-secret" } },
      "fiscal-engine": { healthcheck: {}, environment: {} },
    } }));
    const result = spawnSync(process.env.ERP_TEST_PYTHON || "python3", ["-c", code, file, sha], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const value = JSON.parse(readFileSync(file, "utf8")).services;
    assert.equal(value.api.environment.DANFE_MCP_TOKEN, privateToken);
    assert.equal(value.api.environment.DANFE_MCP_TOOL_PREFIX, "bare");
    assert.equal(value.api.environment.DANFE_MCP_URL, "http://127.0.0.1:8093/mcp");
    assert.equal(value.web.environment.ERP_SESSION_SECRET, "synthetic-original-session-secret");
    assert.equal(value["fiscal-mcp"].image, "erp-next-fiscal-mcp:sha-" + sha);
    assert.equal(value["fiscal-mcp"].read_only, true);
    assert.equal(value["fiscal-mcp"].network_mode, "service:api");
    assert.match(dispatcher, /compose_overlay_args=\(--file "\$release\/fiscal-compose.yaml"\)/);
    assert.equal((dispatcher.match(/up --detach --no-build --remove-orphans --wait/g) || []).length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
