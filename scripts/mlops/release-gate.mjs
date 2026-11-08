import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const SHA = /^[a-f0-9]{40}$/;
const TEXT_MAX = 20 * 1024 * 1024;

export function validateReleaseInputs(input) {
  if (!SHA.test(input.sourceSha ?? "") || !SHA.test(input.checkoutSha ?? "") ||
      input.sourceSha !== input.checkoutSha) throw new Error("SOURCE_SHA_MISMATCH");
  if (input.ref !== "refs/heads/main") throw new Error("NOT_MAIN_BRANCH");
  if (!/^[0-9]+$/.test(String(input.runId ?? "")) || !/^[1-9][0-9]*$/.test(String(input.runAttempt ?? ""))) {
    throw new Error("INVALID_RUN_ID");
  }
  if (typeof input.repository !== "string" || input.repository.toLowerCase() !== "avilaops/erp-next") {
    throw new Error("REPOSITORY_MISMATCH");
  }
  for (const name of ["fiscal-engine", "api", "web"]) {
    if (input.jobs?.[name]?.result !== "success") throw new Error("REQUIRED_JOB_NOT_SUCCESS:" + name);
  }
}

export function inspectOpenApi(bytes) {
  if (!bytes.length || bytes.length > TEXT_MAX) throw new Error("INVALID_OPENAPI_SIZE");
  const doc = JSON.parse(bytes.toString("utf8"));
  if (!/^3\.[01]\.\d+$/.test(doc.openapi ?? "") ||
      !doc.info?.title || !doc.paths || Array.isArray(doc.paths) ||
      Object.keys(doc.paths).length === 0) throw new Error("INVALID_OPENAPI");
  function refs(value) {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "$ref") && (typeof value.$ref !== "string" || !value.$ref.startsWith("#/"))) {
      throw new Error("EXTERNAL_OPENAPI_REF");
    }
    for (const child of Object.values(value)) refs(child);
  }
  refs(doc);
  return { pathCount: Object.keys(doc.paths).length, sha256: sha256(bytes) };
}

export function inspectValidation(manifestBytes, pdfBytes, pngBytes) {
  if (manifestBytes.length > 100_000 || pdfBytes.length > TEXT_MAX || pngBytes.length > TEXT_MAX) throw new Error("INVALID_VALIDATION_SIZE");
  const doc = JSON.parse(manifestBytes.toString("utf8"));
  if (!Array.isArray(doc.fields) || doc.fields.length !== 11 || new Set(doc.fields.map(f => f.name)).size !== 11) {
    throw new Error("INVALID_VALIDATION_FIELDS");
  }
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("INVALID_VALIDATION_PDF");
  if (!pngBytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("INVALID_VALIDATION_PNG");
  if (sha256(pdfBytes) !== doc.sha256) throw new Error("VALIDATION_PDF_HASH_MISMATCH");
  return { fieldCount: 11, manifestSha256: sha256(manifestBytes), pdfSha256: sha256(pdfBytes), pngSha256: sha256(pngBytes) };
}

export async function evaluateRelease(input, artifactDirectory) {
  validateReleaseInputs(input);
  const evidence = resolve(artifactDirectory);
  const [contract, manifest, pdf, png] = await Promise.all([
    readFile(join(evidence, "contracts", "candidate.json")),
    readFile(join(evidence, "validation", "validation.json")),
    readFile(join(evidence, "validation", "validation.pdf")),
    readFile(join(evidence, "validation", "validation.png")),
  ]);
  return {
    schemaVersion: "avila-mlops-release-evidence/1",
    identity: {
      repository: input.repository, sourceSha: input.sourceSha,
      workflowRunId: String(input.runId), attempt: Number(input.runAttempt),
    },
    jobs: Object.fromEntries(["fiscal-engine", "api", "web"].map(n => [n, "success"])),
    evidence: { openapi: inspectOpenApi(contract), validation: inspectValidation(manifest, pdf, png) },
    metrics: { aiQuality: null, tokenCostUsd: null, llmLatencyMs: null, regressionsMeasured: null },
    technicalVerdict: "passed",
    humanApproval: "not_evaluated",
    productionSmoke: "not_evaluated",
    note: "Apenas contrato e artefatos produzidos nos jobs reais deste workflow. Não prova deploy nem aprovação humana.",
  };
}

async function main() {
  const input = {
    repository: process.env.GITHUB_REPOSITORY,
    sourceSha: process.env.SOURCE_SHA,
    checkoutSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root }).trim(),
    ref: process.env.GITHUB_REF,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    jobs: JSON.parse(process.env.NEEDS_JSON ?? "{}"),
  };
  const report = await evaluateRelease(input, process.env.MLOPS_ARTIFACTS_DIR ?? join(root, "artifacts", "mlops-input"));
  const out = join(root, "artifacts", "mlops-release", report.identity.sourceSha);
  await mkdir(out, { recursive: true });
  const data = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(out, "report.json"), data, { flag: "wx", mode: 0o600 });
  const digest = sha256(data);
  await writeFile(join(out, "report.sha256"), digest + "  report.json\n", { flag: "wx", mode: 0o600 });
  const lines = [
    "### Ávila MLOps · verificação técnica de release",
    `- Commit: \`${report.identity.sourceSha}\``,
    `- Workflow: ${report.identity.workflowRunId} / tentativa ${report.identity.attempt}`,
    `- Contrato OpenAPI: ${report.evidence.openapi.pathCount} caminhos; SHA-256 \`${report.evidence.openapi.sha256}\``,
    `- Template: ${report.evidence.validation.fieldCount} campos; PDF SHA-256 \`${report.evidence.validation.pdfSha256}\``,
    "- Testes prévios: fiscal-engine, API e web bem-sucedidos",
    "- IA/Langfuse e smoke de produção: não avaliados nesta etapa",
    `- Evidência: \`${digest}\` (SHA-256 de report.json)`,
  ];
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });
  console.log(JSON.stringify({ technicalVerdict: report.technicalVerdict, sha: report.identity.sourceSha, reportSha256: digest }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error("MLOPS_RELEASE_GATE_FAILED", error instanceof Error ? error.message : "unknown"); process.exitCode = 1; });
}
