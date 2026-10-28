import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery.mjs';
import { assessContracts } from '../contracts.mjs';

const root = new URL('../../', import.meta.url);
const catalogue = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'));

test('every production API operation and BFF has a contract without claiming verified flows or a completed P0', async () => {
  const inventory = await discover(fileURLToPath(root));
  const assessment = assessContracts(catalogue, inventory);
  assert.deepEqual(assessment.findings, []);
  assert.equal(assessment.apiOperations, 96);
  assert.equal(assessment.bffOperations, 77);
  assert.equal(assessment.pendingFlows, 25);
  assert.equal(assessment.p0Ready, false);
  assert.equal(assessment.runtimeVerdict, 'not_verified_by_catalog');
  for (const action of catalogue.actions) {
    for (const file of action.sources) await readFile(new URL(file, root));
    if (action.input.body) {
      const { source, type } = action.input.body;
      assert.match(await readFile(new URL(source, root), 'utf8'), new RegExp(`\\b(?:struct|enum)\\s+${type}\\b`));
    }
  }
});

test('new undocumented routes, stale contracts, missing preconditions and false verification are rejected', async () => {
  const inventory = await discover(fileURLToPath(root));
  const stale = structuredClone(catalogue);
  stale.actions[0].operation.path = '/api/v1/does-not-exist';
  stale.actions[1].transition = {};
  stale.actions[2].verification.status = 'passed';
  const findings = assessContracts(stale, inventory).findings;
  for (const code of ['contract_without_api', 'api_without_action_contract', 'incomplete_action_contract', 'contract_is_not_runtime_evidence']) assert.ok(findings.some(finding => finding.code === code), code);
  const added = structuredClone(inventory);
  added.bff.push({ path: '/api/erp/undocumented', methods: ['POST'] });
  assert.ok(assessContracts(catalogue, added).findings.some(finding => finding.code === 'bff_without_action_contract'));
});

test('blocked NF-e remains blocked and dynamic BFF actions cannot invent commands', async () => {
  const inventory = await discover(fileURLToPath(root));
  const changed = structuredClone(catalogue);
  const issue = changed.actions.find(action => action.operation.path.endsWith('/issue'));
  issue.response.successStatuses = [200];
  const confirm = changed.actions.find(action => action.operation.path.endsWith('/confirm'));
  confirm.ui.bff.action = 'invented-command';
  const findings = assessContracts(changed, inventory).findings;
  assert.ok(findings.some(finding => finding.code === 'blocked_action_claims_success'));
  assert.ok(findings.some(finding => finding.code === 'undefined_dispatch_action'));
  assert.ok(findings.some(finding => finding.code === 'wrong_bff_target'));
});

test('catalogue changes are part of source provenance and read preconditions are not invented', async () => {
  const inventory = await discover(fileURLToPath(root));
  assert.ok(inventory.sourceFiles.some(file => file.file === 'verification/contracts.json'));
  const product = catalogue.actions.find(action => action.operation.method === 'PUT' && action.operation.path === '/api/v1/products/{id}');
  assert.equal(product.concurrency.revision, true);
  assert.equal(product.concurrency.idempotency, false);
  const reference = catalogue.actions.find(action => action.operation.method === 'PUT' && action.operation.path === '/api/v1/product-categories/{id}');
  assert.equal(reference.concurrency.idempotency, true);
  const movement = catalogue.actions.find(action => action.operation.method === 'POST' && action.operation.path === '/api/v1/stock/movements');
  assert.ok(movement.preconditions.some(value => value.includes('Não exige revisão no corpo ou If-Match')));
  assert.equal(movement.input.headers.includes('If-Match'), false);
});

test('auxiliary catalogue contracts preserve filter, not-found, conflict and precondition failures', () => {
  for (const resource of ['product-categories', 'financial-categories', 'financial-accounts', 'payment-methods']) {
    for (const [method, suffix, expected] of [
      ['GET', '', [422]], ['GET', '/{id}', [404]],
      ['POST', '', [409, 422, 428]], ['PUT', '/{id}', [400, 404, 409, 412, 422, 428]],
    ]) {
      const action = catalogue.actions.find(item => item.operation.method === method && item.operation.path === `/api/v1/${resource}${suffix}`);
      for (const status of expected) assert.ok(action.response.errorStatuses.includes(status), `${method} ${resource}${suffix}: missing ${status}`);
    }
  }
});

test('mandatory command keys cannot silently lose their 428 failure contract', async () => {
  const inventory = await discover(fileURLToPath(root));
  const changed = structuredClone(catalogue);
  const action = changed.actions.find(item => item.operation.method === 'POST' && item.operation.path === '/api/v1/financial-accounts');
  action.response.errorStatuses = action.response.errorStatuses.filter(status => status !== 428);
  assert.ok(assessContracts(changed, inventory).findings.some(finding => finding.code === 'missing_precondition_failure'));
});
