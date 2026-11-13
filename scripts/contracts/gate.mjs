import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import reviewedCorrection from './reviewed-correction-avl402.json' with { type: 'json' };
import reviewedFiscalEnvironments from './reviewed-fiscal-environments.json' with { type: 'json' };
import baselineRepair from './baseline-1196d52.json' with { type: 'json' };
import { validateOpenApi } from './consumer/openapi-validation.mjs';

const inputPaths = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain', '.cargo', '.sqlx', 'apps/api', 'migrations', 'queries', 'deploy'];

function validateBaselineReuse(capture, baselineSha256, candidateSha256) {
  if (!capture || (capture.captureMode !== 'identical_api_inputs' && !('baselineReuseProof' in capture))) return false;
  const proof = capture.baselineReuseProof, rows = capture.candidateSources;
  const required = ['Cargo.toml', 'Cargo.lock', 'apps/api/Cargo.toml', 'apps/api/src/http/openapi.rs', 'apps/api/src/http/openapi_export.rs'];
  const validRows = Array.isArray(rows) && rows.length > 0 && rows.every((row, index) => row
    && isDeepStrictEqual(Object.keys(row).sort(), ['path', 'sha256']) && typeof row.path === 'string'
    && !/[\\\r\n]/.test(row.path) && !row.path.split('/').some(part => ['', '.', '..'].includes(part))
    && inputPaths.some(prefix => row.path === prefix || row.path.startsWith(`${prefix}/`))
    && /^[0-9a-f]{64}$/.test(row.sha256 ?? '') && (index === 0 || rows[index - 1].path < row.path));
  if (capture.captureMode !== 'identical_api_inputs' || capture.initialContract !== false
      || capture.baselineInstrumented !== false || 'baselineCompilationRepair' in capture
      || capture.historicalCompatibilityVerified !== false || !/^[0-9a-f]{40}$/.test(capture.eventBaseRevision ?? '')
      || !/^[0-9a-f]{40}$/.test(capture.candidateRevision ?? '') || capture.baselineRevision !== capture.eventBaseRevision
      || capture.baselineRevision === baselineRepair.revision || baselineSha256 !== candidateSha256
      || !validRows || !required.every(name => rows.some(row => row.path === name))
      || !rows.some(row => ['rust-toolchain.toml', 'rust-toolchain'].includes(row.path))
      || !isDeepStrictEqual(rows, capture.baselineSources) || !isDeepStrictEqual(rows, capture.eventBaseSources)
      || rows.find(row => row.path === 'apps/api/src/http/openapi_export.rs')?.sha256 !== capture.helperSha256
      || proof?.schemaVersion !== 'erp-identical-api-inputs/1' || !isDeepStrictEqual(proof.inputPaths, inputPaths)
      || proof.inputAudit !== 'static-rust-inputs/1' || proof.sourceCount !== rows.length
      || proof.candidateSha256 !== candidateSha256
      || proof.sourcesSha256 !== createHash('sha256').update(rows.map(row => `${row.sha256}  ${row.path}\n`).join('')).digest('hex')) {
    throw new Error('INVALID_IDENTICAL_API_INPUTS_PROOF');
  }
  return true;
}

export async function readOpenApi(file) {
  const bytes = await readFile(file);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('INVALID_OPENAPI');
  const document = JSON.parse(bytes);
  if (!/^3\.[01]\.\d+$/.test(document.openapi ?? '') || !document.info || !document.paths
      || Array.isArray(document.paths) || typeof document.paths !== 'object') throw new Error('INVALID_OPENAPI');
  // The contract is self-contained: neither the comparator nor type generator may fetch refs.
  function check(value) {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value && (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/'))) throw new Error('INVALID_OPENAPI_EXTERNAL_REF');
    for (const item of Object.values(value)) check(item);
  }
  check(document);
  await validateOpenApi(document);
  return { document, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function evaluateCompatibilityPolicy(report) {
  if (report.compatible === true && Array.isArray(report.findings) && report.findings.length === 0) {
    return { accepted: true, reason: 'compatible', reviewedCorrection: null };
  }
  // A reviewed documentation correction is an admission decision, never a rewrite
  // of oasdiff's compatibility result. Both immutable contracts must match.
  const order = findings => [...findings].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const reviewed = [reviewedCorrection, reviewedFiscalEnvironments].find(correction => report.compatible === false
    && report.comparisonScope === 'event_base'
    && report.eventBaseCompatibilityVerified === false
    && report.runtimeVerified === false
    && report.baselineSha256 === correction.baselineSha256
    && report.candidateSha256 === correction.candidateSha256
    && isDeepStrictEqual(report.comparator, correction.comparator)
    && Array.isArray(report.findings)
    && report.findings.length === correction.findings.length
    && report.findings.every(item => item && typeof item.fingerprint === 'string')
    && isDeepStrictEqual(order(report.findings), order(correction.findings)));
  const accepted = Boolean(reviewed);
  return {
    accepted,
    reason: accepted ? reviewed.admissionReason || 'reviewed_schema_correction' : 'unreviewed_incompatibility',
    reviewedCorrection: accepted ? reviewed.id : null,
  };
}

export async function compareContracts({ baseline, candidate, output, executable = process.env.OASDIFF_BIN ?? 'oasdiff' }) {
  const base = await readOpenApi(baseline), revision = await readOpenApi(candidate);
  const result = spawnSync(executable, ['breaking', '--fail-on', 'WARN', '--format', 'json', baseline, candidate],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('COMPARATOR_FAILED');
  let findings;
  try { findings = JSON.parse(result.stdout); } catch { throw new Error('COMPARATOR_INVALID_RESULT'); }
  if (findings === null && result.status === 0) findings = [];
  if (!Array.isArray(findings) || findings.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')
      || (result.status === 1 && findings.length === 0) || (result.status === 0 && findings.length > 0)) throw new Error('COMPARATOR_INVALID_RESULT');
  let capture;
  try { capture = JSON.parse(await readFile(path.join(output, 'capture.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('INVALID_CAPTURE'); }
  if (capture && (capture.schemaVersion !== 'erp-openapi-capture/1'
      || capture.captures?.find(item => item.label === 'baseline')?.sha256 !== base.sha256
      || capture.captures?.find(item => item.label === 'candidate')?.sha256 !== revision.sha256)) throw new Error('CAPTURE_HASH_MISMATCH');
  const reused = validateBaselineReuse(capture, base.sha256, revision.sha256);
  const repaired = Boolean(capture?.baselineCompilationRepair);
  if (repaired && (!isDeepStrictEqual(capture.baselineCompilationRepair, baselineRepair)
      || capture.eventBaseRevision !== baselineRepair.revision || capture.baselineRevision !== baselineRepair.revision
      || capture.initialContract !== false || capture.historicalCompatibilityVerified !== false
      || capture.baselineSources?.find(item => item.path === baselineRepair.path)?.sha256 !== baselineRepair.beforeSha256)) throw new Error('INVALID_BASELINE_COMPILATION_REPAIR');
  await mkdir(output, { recursive: true });
  const report = { schemaVersion: 'erp-openapi-compatibility/1', comparator: { name: 'oasdiff', version: '1.34.1', failOn: 'WARN' },
    baselineSha256: base.sha256, candidateSha256: revision.sha256, compatible: result.status === 0, findings,
    comparisonScope: capture ? (reused ? 'identical_api_inputs' : repaired ? 'instrumented_event_base' : capture.initialContract ? 'initial_contract' : 'event_base') : 'provided_documents',
    eventBaseCompatibilityVerified: Boolean(capture && !reused && !repaired && !capture.initialContract && result.status === 0),
    runtimeVerified: false, limitations: ['Compares declared OpenAPI structure; does not prove domain semantics, authorization or complete route coverage.'] };
  if (reused) {
    report.baselineReuseProof = capture.baselineReuseProof;
    report.limitations.push('The baseline reuses the candidate export because the recorded repository API build inputs are identical. A historical binary was not separately executed; this does not prove historical runtime behavior or external build-environment equivalence.');
  }
  if (repaired) {
    report.baselineCompilationRepair = capture.baselineCompilationRepair;
    report.limitations.push('The exact historical baseline required internal Rust visibility instrumentation to compile. The unmodified event base was not executable; this is a declared-schema comparison, not proof of historical runtime compatibility.');
  }
  report.policyDecision = evaluateCompatibilityPolicy(report);
  await writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baseline, candidate, output] = process.argv.slice(2);
  if (!baseline || !candidate || !output) { console.error('Usage: gate.mjs BASE CANDIDATE OUTPUT'); process.exitCode = 2; }
  else try { const report = await compareContracts({ baseline, candidate, output }); console.log(JSON.stringify({ compatible: report.compatible, findings: report.findings.length, policyDecision: report.policyDecision })); if (!report.policyDecision.accepted) process.exitCode = 1; }
  catch (error) { console.error(error.message); if (error.details) console.error(JSON.stringify(error.details.slice(0,12))); process.exitCode = 2; }
}
