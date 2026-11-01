import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery.mjs';
import { buildProductContext, contextMarkdown, contextSourcePaths, selectProductFlows, sha256, stableJson, validateProductContext, validateProductFlows } from '../product-context.mjs';
import { readContextFile, writeImmutable } from '../product-context-cli.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogue = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'));
const inventoryPromise = discover(root);
const source = {
  repository: 'avilaops/erp-next', commit: '1'.repeat(40), dirty: false,
  gitStatusSha256: '2'.repeat(64), catalogSha256: '3'.repeat(64), inventorySha256: '4'.repeat(64),
  contextFiles: [{ path: 'verification/contracts.json', sha256: '5'.repeat(64) }],
};

test('every canonical action has one product owner and declared journeys are explicitly defined', async () => {
  assert.deepEqual(validateProductFlows(catalogue), []);
  const context = buildProductContext(catalogue, await inventoryPromise, source);
  assert.equal(context.flows.length, 34);
  assert.equal(context.actions.length, 176);
  assert.equal(context.pendingFlows.length, 35);
  assert.deepEqual(context.flows.filter(flow => flow.definitionState === 'journey_defined').map(flow => flow.definition.id).sort(), ['audit', 'commercial-returns', 'commissions', 'financial-settings', 'fiscal-emission', 'fiscal-incoming', 'personal-preferences', 'production', 'products', 'purchase_payment_chain', 'sales-settings', 'users']);
  assert.equal(context.actions.find(action => action.operation.path.endsWith('/issue')).status, 'implemented');
  assert.ok(context.flows.every(flow => flow.assessment.execution === 'not_observed' && flow.assessment.publication === 'not_observed'));
});

test('operational journeys include their explicit dependencies while residual scope stays pending', async () => {
  const inventory = await inventoryPromise;
  const returns = buildProductContext(catalogue, inventory, source, 'commercial-returns');
  for (const id of ['commissions', 'production', 'fiscal-emission', 'purchase_payment_chain']) assert.ok(returns.selection.includedFlows.includes(id));
  for (const id of ['post-api-v1-orders-id-cancel-completed', 'post-api-v1-purchase-receipts-id-reverse', 'post-api-v1-fiscal-nfe-id-issue']) assert.ok(returns.actions.some(action => action.id === id));
  const incoming = buildProductContext(catalogue, inventory, source, 'fiscal-incoming');
  assert.ok(incoming.actions.some(action => action.operation.path === '/api/v1/fiscal/monitor'));
  assert.ok(incoming.actions.some(action => action.operation.path === '/api/v1/fiscal/received-nfes/{id}/purchase'));
  assert.match(catalogue.pendingFlows.find(flow => flow.id === 'pending-6').intent, /implementados/);
  assert.match(catalogue.pendingFlows.find(flow => flow.id === 'pending-19').intent, /produção permanece bloqueada/);
  assert.ok(incoming.actions.every(action => action.verification.status === 'not_verified_by_catalog'));
});

test('a task includes its transitive dependencies and real Auth handler sources without unrelated purchase actions', async () => {
  const inventory = await inventoryPromise;
  const definitions = selectProductFlows(catalogue, 'users');
  assert.deepEqual(definitions.map(flow => flow.id), ['company_onboarding', 'me', 'permissions', 'roles', 'runtime', 'users']);
  const context = buildProductContext(catalogue, inventory, source, 'users');
  for (const id of ['create-invitation', 'get-api-v1-companies', 'get-api-v1-roles']) assert.ok(context.actions.some(action => action.id === id));
  assert.ok(context.actions.every(action => action.flow !== 'purchase_payment_chain'));
  const paths = contextSourcePaths(catalogue, inventory, definitions);
  assert.ok(paths.includes('apps/web/src/app/api/auth/callback/route.ts'));
  assert.ok(paths.includes('migrations/202610280007_user_invitations.sql'));
  assert.match(contextMarkdown(context), /Usuários e convites/);
  assert.match(contextMarkdown(context), /platform\.users\.manage/);
});

test('unknown references, duplicate ownership, and invented runtime state are rejected', () => {
  const unknown = structuredClone(catalogue);
  unknown.productFlows.flows.find(flow => flow.id === 'users').journey[0].actionIds.push('invented-action');
  assert.ok(validateProductFlows(unknown).some(item => item.code === 'unknown_journey_action'));
  const duplicate = structuredClone(catalogue);
  duplicate.productFlows.flows.find(flow => flow.id === 'runtime').actionGroups.push('users');
  assert.ok(validateProductFlows(duplicate).some(item => item.code === 'duplicate_action_group_owner'));
  const missing = structuredClone(catalogue);
  missing.productFlows.flows = missing.productFlows.flows.filter(flow => flow.id !== 'legacy-history');
  assert.ok(validateProductFlows(missing).some(item => item.code === 'unowned_action_group'));
  const falseState = structuredClone(catalogue);
  falseState.productFlows.flows.find(flow => flow.id === 'users').execution = 'passed';
  assert.ok(validateProductFlows(falseState).some(item => item.code === 'invalid_product_flow_schema'));
});

test('cycles, unknown dependencies, and undeclared cross-flow actions fail before generation', () => {
  const cyclic = structuredClone(catalogue);
  cyclic.productFlows.flows.find(flow => flow.id === 'runtime').dependencies.push('users');
  assert.ok(validateProductFlows(cyclic).some(item => item.code === 'cyclic_flow_dependency'));
  const foreign = structuredClone(catalogue);
  foreign.productFlows.flows.find(flow => flow.id === 'users').journey[0].actionIds.push('post-api-v1-payables-id-payments');
  assert.ok(validateProductFlows(foreign).some(item => item.code === 'undeclared_journey_dependency'));
  const unknown = structuredClone(catalogue);
  unknown.productFlows.flows.find(flow => flow.id === 'users').dependencies.push('does-not-exist');
  assert.ok(validateProductFlows(unknown).some(item => item.code === 'unknown_flow_dependency'));
  assert.throws(() => selectProductFlows(catalogue, 'unknown'), /não encontrada/);
});

test('the same inputs produce identical bytes and a content change invalidates the old digest', async () => {
  const inventory = await inventoryPromise;
  const first = buildProductContext(catalogue, inventory, source, 'products');
  const second = buildProductContext(structuredClone(catalogue), inventory, structuredClone(source), 'products');
  assert.equal(stableJson(first), stableJson(second));
  assert.deepEqual(validateProductContext(first), []);
  const changed = structuredClone(first);
  changed.flows[0].definition.goal += ' Alterado.';
  assert.ok(validateProductContext(changed).some(item => item.code === 'context_digest_mismatch'));
  const invented = structuredClone(first);
  invented.flows[0].assessment.execution = 'passed';
  assert.ok(validateProductContext(invented).some(item => item.code === 'invalid_product_context_schema'));
  const updatedSource = { ...source, inventorySha256: sha256('different source') };
  assert.notEqual(buildProductContext(catalogue, inventory, updatedSource, 'products').contentSha256, first.contentSha256);
});

test('context file reads reject traversal and private environment files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'erp-context-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, 'src', 'module.ts'), 'export const valid = true;');
  assert.match((await readContextFile(directory, 'src/module.ts')).toString(), /valid/);
  await writeFile(path.join(directory, 'src', 'controller.rb'), 'class Controller; end');
  assert.match((await readContextFile(directory, 'src/controller.rb')).toString(), /class Controller/);
  for (const invalid of ['../outside.json', '/outside.json', 'src/../../outside.json', '.env', 'src/.env.json', 'src/.env.rb', 'src/../../outside.rb', 'src\\module.ts']) {
    await assert.rejects(() => readContextFile(directory, invalid), /arquivo de fonte relativo/);
  }
});

test('artifact retries preserve identical bytes and refuse to overwrite a different existing file', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'erp-context-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'context.json');
  await writeImmutable(output, 'original');
  await writeImmutable(output, 'original');
  await assert.rejects(() => writeImmutable(output, 'changed'), /foi preservado/);
  assert.equal(await readFile(output, 'utf8'), 'original');
});
