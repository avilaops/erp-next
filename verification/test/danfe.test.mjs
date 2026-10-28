import test from 'node:test';
import assert from 'node:assert/strict';
import { DANFE_PLAN, assessDanfeSuite } from '../danfe.mjs';
const snapshot = { sha256: 'a'.repeat(64), files: [] };
const output = () => ({ verdict: 'passed', log: DANFE_PLAN.checks.map(check => `test ${check.test} ... ok`).join('\n') });

test('all named tests bind only the isolated API flow, not browser or real fiscal authorization', () => {
  const flow = assessDanfeSuite(output(), snapshot, snapshot);
  assert.equal(flow.verdict, 'passed');
  assert.equal(flow.authAdapter, 'synthetic');
  assert.equal(flow.mcpAdapter, 'test_double');
  assert.ok(flow.unverified.includes('browser_flow'));
  assert.ok(flow.unverified.includes('real_authorized_customer_xml'));
  assert.match(flow.logSha256, /^[a-f0-9]{64}$/);
});
test('an empty successful command, missing test or duplicate result cannot approve the flow', () => {
  for (const log of ['', output().log.split('\n').slice(1).join('\n'), `${output().log}\n${output().log.split('\n')[0]}`]) {
    assert.equal(assessDanfeSuite({ verdict: 'passed', log }, snapshot, snapshot).verdict, 'inconclusive');
  }
});
test('test failures, process failures and code changes remain visible', () => {
  const failed = output(); failed.log = failed.log.replace('... ok', '... FAILED');
  assert.equal(assessDanfeSuite(failed, snapshot, snapshot).verdict, 'failed');
  assert.equal(assessDanfeSuite({ ...output(), verdict: 'failed' }, snapshot, snapshot).verdict, 'failed');
  assert.equal(assessDanfeSuite(output(), snapshot, { sha256: 'b'.repeat(64) }).verdict, 'inconclusive');
});
