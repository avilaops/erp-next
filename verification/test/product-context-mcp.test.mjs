import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery.mjs';
import { buildProductContext, stableJson, validateProductContext } from '../product-context.mjs';
import { contextBundle } from '../product-context-mcp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogue = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'));
const inventory = await discover(root);
const source = {
  repository: 'avilaops/erp-next', commit: '1'.repeat(40), dirty: true,
  gitStatusSha256: '2'.repeat(64), catalogSha256: '3'.repeat(64), inventorySha256: inventory.sourceHash,
  contextFiles: [{ path: 'verification/contracts.json', sha256: '5'.repeat(64) }],
};
const contexts = ['users', 'products', 'purchase_payment_chain'].map(flow => buildProductContext(catalogue, inventory, source, flow));

test('MCP rows preserve complete validated artifacts and keep the index small', () => {
  const bundle = contextBundle(contexts);
  assert.equal(bundle.tables.index.length, 3);
  assert.equal(bundle.tables.snapshots.length, 3);
  for (const row of bundle.tables.index) {
    const snapshot = bundle.tables.snapshots.find(item => item.content_sha256 === row.content_sha256);
    const restored = JSON.parse(snapshot.context_json);
    assert.deepEqual(validateProductContext(restored), []);
    assert.equal(restored.selection.targetFlow, row.flow);
    assert.equal(restored.source.dirty, row.source_dirty);
    assert.equal(row.publication, 'not_observed');
    assert.equal(row.execution, 'not_observed');
    assert.equal(restored.actions.length, row.action_count);
    assert.ok(Buffer.byteLength(JSON.stringify(row)) < 2000);
  }
  assert.equal(stableJson(contextBundle([...contexts].reverse())), stableJson(bundle));
});

test('MCP export rejects tampered artifacts and duplicate selections', () => {
  const invalid = structuredClone(contexts[0]);
  invalid.actions[0].status = 'blocked';
  assert.throws(() => contextBundle([invalid]), /context_digest_mismatch/);
  assert.throws(() => contextBundle([contexts[0], contexts[0]]), /distinta/);
  assert.throws(() => contextBundle([]), /ao menos um/);
});

test('MCP export refuses to mix commits or working-tree states across a bundle', () => {
  for (const change of [{ commit: '6'.repeat(40) }, { gitStatusSha256: '7'.repeat(64) }, { dirty: false }]) {
    const other = buildProductContext(catalogue, inventory, { ...source, ...change }, 'products');
    assert.throws(() => contextBundle([contexts[0], other]), /estados de fonte diferentes/);
  }
});
