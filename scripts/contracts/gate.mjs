import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import reviewedCorrection from './reviewed-correction-avl402.json' with { type: 'json' };
import { validateOpenApi } from './consumer/openapi-validation.mjs';

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
  const accepted = report.compatible === false
    && report.comparisonScope === 'event_base'
    && report.eventBaseCompatibilityVerified === false
    && report.runtimeVerified === false
    && report.baselineSha256 === reviewedCorrection.baselineSha256
    && report.candidateSha256 === reviewedCorrection.candidateSha256
    && isDeepStrictEqual(report.comparator, reviewedCorrection.comparator)
    && Array.isArray(report.findings)
    && report.findings.length === reviewedCorrection.findings.length
    && report.findings.every(item => item && typeof item.fingerprint === 'string')
    && isDeepStrictEqual(order(report.findings), order(reviewedCorrection.findings));
  return {
    accepted,
    reason: accepted ? 'reviewed_schema_correction' : 'unreviewed_incompatibility',
    reviewedCorrection: accepted ? reviewedCorrection.id : null,
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
  await mkdir(output, { recursive: true });
  const report = { schemaVersion: 'erp-openapi-compatibility/1', comparator: { name: 'oasdiff', version: '1.34.1', failOn: 'WARN' },
    baselineSha256: base.sha256, candidateSha256: revision.sha256, compatible: result.status === 0, findings,
    comparisonScope: capture ? (capture.initialContract ? 'initial_contract' : 'event_base') : 'provided_documents',
    eventBaseCompatibilityVerified: Boolean(capture && !capture.initialContract && result.status === 0),
    runtimeVerified: false, limitations: ['Compares declared OpenAPI structure; does not prove domain semantics, authorization or complete route coverage.'] };
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
