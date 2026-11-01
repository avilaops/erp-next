import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as gate from '../gate.mjs';
const evaluateCompatibilityPolicy = report => {
  assert.equal(typeof gate.evaluateCompatibilityPolicy, 'function', 'the gate must evaluate the reviewed correction policy');
  return gate.evaluateCompatibilityPolicy(report);
};

const captured = JSON.parse(await readFile(new URL('./fixtures/avl402-comparison.json', import.meta.url)));
function decision(change = () => {}) {
  const report = structuredClone(captured);
  change(report);
  return evaluateCompatibilityPolicy(report);
}

test('only the twelve reviewed findings and both captured contracts are accepted', () => {
  const original = structuredClone(captured);
  const result = evaluateCompatibilityPolicy(captured);
  assert.deepEqual(result, { accepted: true, reason: 'reviewed_schema_correction', reviewedCorrection: 'AVL-402-2026-11-01' });
  assert.deepEqual(captured, original, 'the raw comparator report must stay intact');
  assert.equal(captured.compatible, false);
  assert.equal(captured.eventBaseCompatibilityVerified, false);
  assert.equal(captured.runtimeVerified, false);
  assert.equal(captured.findings.length, 12);
});

test('finding order does not change the approved set', () => {
  assert.equal(decision(report => report.findings.reverse()).accepted, true);
});

for (const [field, value] of [
  ['baselineSha256', '0'.repeat(64)],
  ['candidateSha256', '0'.repeat(64)],
  ['comparisonScope', 'provided_documents'],
  ['comparisonScope', 'initial_contract'],
]) {
  test('an unreviewed ' + field + '=' + value + ' is rejected', () => {
    assert.equal(decision(report => { report[field] = value; }).accepted, false);
  });
}

for (const [field, value] of [
  ['fingerprint', 'different'],
  ['id', 'endpoint-removed'],
  ['path', '/api/v1/company'],
  ['operation', 'DELETE'],
  ['operationId', 'other_handler'],
  ['level', 2],
  ['text', 'a different schema change'],
  ['section', 'components'],
]) {
  test('a changed finding ' + field + ' is rejected', () => {
    assert.equal(decision(report => { report.findings[0][field] = value; }).accepted, false);
  });
}

test('additional finding metadata is not silently ignored', () => {
  assert.equal(decision(report => { report.findings[0].unexpected = true; }).accepted, false);
});
test('an extra incompatibility is rejected', () => {
  assert.equal(decision(report => { report.findings.push({ id: 'endpoint-removed', fingerprint: 'extra' }); }).accepted, false);
});
test('a missing reviewed finding is rejected', () => {
  assert.equal(decision(report => { report.findings.pop(); }).accepted, false);
});
test('duplicate findings cannot substitute a reviewed finding', () => {
  assert.equal(decision(report => { report.findings[1] = report.findings[0]; }).accepted, false);
});
test('another comparator version is rejected', () => {
  assert.equal(decision(report => { report.comparator.version = 'different'; }).accepted, false);
});
test('a comparator with a weaker threshold is rejected', () => {
  assert.equal(decision(report => { report.comparator.failOn = 'ERR'; }).accepted, false);
});
test('a clean future baseline uses strict compatibility without the old exception', () => {
  const report = { ...captured, compatible: true, findings: [], baselineSha256: '1'.repeat(64), candidateSha256: '2'.repeat(64) };
  assert.deepEqual(evaluateCompatibilityPolicy(report), { accepted: true, reason: 'compatible', reviewedCorrection: null });
});
test('a failed comparison without findings cannot use the exception', () => {
  assert.equal(decision(report => { report.findings = []; }).accepted, false);
});
test('a compatible flag with findings does not override the policy', () => {
  assert.equal(decision(report => { report.compatible = true; }).accepted, false);
});
test('the real CLI preserves strict success and failure outside the reviewed contracts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'erp-policy-cli-'));
  try {
    const document = { openapi: '3.1.0', info: { title: 'CLI fixture', version: '1' },
      paths: { '/example': { get: { responses: { '200': { description: 'ok' } } } } } };
    const baseline = path.join(directory, 'baseline.json');
    const candidate = path.join(directory, 'candidate.json');
    const entry = new URL('../gate.mjs', import.meta.url);
    await writeFile(baseline, JSON.stringify(document));
    for (const [name, current, expected] of [
      ['clean', document, 0],
      ['removed endpoint', { ...document, paths: {} }, 1],
    ]) {
      await writeFile(candidate, JSON.stringify(current));
      const result = spawnSync(process.execPath, [entry.pathname, baseline, candidate, directory], { encoding: 'utf8' });
      assert.equal(result.status, expected, name + ': ' + result.stderr);
      const printed = JSON.parse(result.stdout);
      const report = JSON.parse(await readFile(path.join(directory, 'comparison.json'), 'utf8'));
      assert.equal(printed.compatible, expected === 0);
      assert.equal(printed.policyDecision.accepted, expected === 0);
      assert.equal(printed.policyDecision.reviewedCorrection, null);
      assert.deepEqual(printed.policyDecision, report.policyDecision);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
