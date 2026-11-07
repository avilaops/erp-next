import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateRelease, inspectOpenApi, inspectValidation, validateReleaseInputs } from "./release-gate.mjs";

const sha = "a".repeat(40);
const valid = {
  repository: "avilaops/ERP-Next", sourceSha: sha, checkoutSha: sha,
  ref: "refs/heads/main", runId: "4000001", runAttempt: "1",
  jobs: Object.fromEntries(["fiscal-engine", "api", "web"].map(x => [x, { result: "success" }])),
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const pdf = Buffer.from("%PDF-1.7\nsynthetic fixture");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const manifest = () => Buffer.from(JSON.stringify({
  sha256: hash(pdf),
  fields: Array.from({ length: 11 }, (_, i) => ({ name: "f" + i })),
}));

test("rejects source mismatch, non-main branch, wrong repo and failed jobs", () => {
  assert.doesNotThrow(() => validateReleaseInputs(valid));
  assert.throws(() => validateReleaseInputs({ ...valid, checkoutSha: "b".repeat(40) }), /SOURCE_SHA_MISMATCH/);
  assert.throws(() => validateReleaseInputs({ ...valid, ref: "refs/heads/feature" }), /NOT_MAIN_BRANCH/);
  assert.throws(() => validateReleaseInputs({ ...valid, repository: "unknown/repo" }), /REPOSITORY_MISMATCH/);
  assert.throws(() => validateReleaseInputs({ ...valid, jobs: { ...valid.jobs, web: { result: "failure" } } }), /REQUIRED_JOB_NOT_SUCCESS:web/);
});

test("rejects external OpenAPI references and missing paths", () => {
  assert.equal(inspectOpenApi(Buffer.from(JSON.stringify({ openapi: "3.1.0", info: { title: "ERP" }, paths: { "/health": { get: { responses: {} } } } }))).pathCount, 1);
  assert.throws(() => inspectOpenApi(Buffer.from(JSON.stringify({ openapi: "3.1.0", info: { title: "ERP" }, paths: {} }))), /INVALID_OPENAPI/);
  assert.throws(() => inspectOpenApi(Buffer.from(JSON.stringify({ openapi: "3.1.0", info: { title: "ERP" }, paths: { "/x": { get: { $ref: "https://example.com/x" } } } }))), /EXTERNAL_OPENAPI_REF/);
});

test("rejects corrupted PDF and inconsistent validation manifest", () => {
  assert.equal(inspectValidation(manifest(), pdf, png).fieldCount, 11);
  const modified = JSON.parse(manifest().toString());
  modified.sha256 = "0".repeat(64);
  assert.throws(() => inspectValidation(Buffer.from(JSON.stringify(modified)), pdf, png), /VALIDATION_PDF_HASH_MISMATCH/);
});

test("produces only measured checks and explicit unmeasured AI metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "erp-mlops-"));
  try {
    await mkdir(join(directory, "contracts"));
    await mkdir(join(directory, "validation"));
    await writeFile(join(directory, "contracts", "candidate.json"), JSON.stringify({
      openapi: "3.0.3", info: { title: "ERP" }, paths: { "/health": { get: { responses: {} } } },
    }));
    await writeFile(join(directory, "validation", "validation.json"), manifest());
    await writeFile(join(directory, "validation", "validation.pdf"), pdf);
    await writeFile(join(directory, "validation", "validation.png"), png);
    const report = await evaluateRelease(valid, directory);
    assert.equal(report.identity.sourceSha, sha);
    assert.equal(report.technicalVerdict, "passed");
    assert.equal(report.humanApproval, "not_evaluated");
    assert.equal(report.productionSmoke, "not_evaluated");
    assert.equal(report.metrics.aiQuality, null);
    assert.equal(report.metrics.regressionsMeasured, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
