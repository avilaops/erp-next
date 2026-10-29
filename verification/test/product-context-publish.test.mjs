import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery.mjs';
import { buildProductContext, sha256, stableJson } from '../product-context.mjs';
import { contextImportRequestId, publishContext } from '../product-context-publish.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogue = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'));
const context = buildProductContext(catalogue, await discover(root), {
  repository: 'avilaops/erp-next', commit: '1'.repeat(40), dirty: false,
  gitStatusSha256: '2'.repeat(64), catalogSha256: '3'.repeat(64), inventorySha256: '4'.repeat(64),
  contextFiles: [{ path: 'verification/contracts.json', sha256: '5'.repeat(64) }],
});

async function api(t, options = {}) {
  let receipt = null, writes = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-token');
    const url = new URL(request.url, 'http://localhost');
    const reply = (status, data, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(data)); };
    if (url.searchParams.has('requestId')) return reply(receipt ? 200 : 404, receipt || { error: 'absent' });
    if (url.searchParams.has('sha256')) return reply(200, options.corrupt ? { ...context, contentSha256: '0'.repeat(64) } : context);
    if (request.method === 'GET') return reply(200, { revision: 0 }, { ETag: '"0"' });
    writes++;
    assert.equal(request.headers['if-match'], '"0"');
    if (options.conflict) return reply(412, { error: 'revision conflict' });
    let body = ''; for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), { context, confirmPublication: false });
    receipt = { requestId: contextImportRequestId(context.contentSha256, false), contentSha256: context.contentSha256,
      sourceCommit: context.source.commit, sourceDirty: false, revision: 1, importedAt: '2026-10-28T00:00:00.000Z', publication: { state: 'not_observed' }, execution: 'not_observed' };
    if (options.loseResponse) return response.destroy();
    reply(200, { receipt, reused: false, currentRevision: 1 });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { endpoint: `http://127.0.0.1:${server.address().port}/api/v1/product-contexts/erp`, token: 'fixture-token', writes: () => writes };
}

test('a confirmed retry reads the same capture without another PUT', async t => {
  const server = await api(t);
  assert.equal((await publishContext(context, server)).reused, false);
  assert.equal((await publishContext(context, server)).reused, true);
  assert.equal(server.writes(), 1);
});
test('a lost PUT response is recovered by receipt and complete readback, without resubmitting', async t => {
  const server = await api(t, { loseResponse: true });
  const result = await publishContext(context, server);
  assert.equal(result.recovered, true);
  assert.equal(server.writes(), 1);
});
test('revision conflicts and divergent readback remain failures', async t => {
  const conflict = await api(t, { conflict: true });
  await assert.rejects(publishContext(context, conflict), error => error.code === 'IMPORT_HTTP_412');
  assert.equal(conflict.writes(), 1);
  const corrupt = await api(t, { corrupt: true });
  await assert.rejects(publishContext(context, corrupt), error => error.code === 'READBACK_MISMATCH');
  assert.equal(corrupt.writes(), 1);
});
test('credentials cannot be sent to arbitrary origins and dirty code cannot claim publication', async () => {
  await assert.rejects(publishContext(context, { endpoint: 'https://example.com/api/v1/product-contexts/erp', token: 'private-fixture' }), error => error.code === 'INVALID_ENDPOINT');
  await assert.rejects(publishContext(context, { token: '' }), error => error.code === 'TOKEN_REQUIRED');
  const { contentSha256, ...payload } = structuredClone(context);
  payload.source.dirty = true;
  const dirty = { ...payload, contentSha256: sha256(stableJson(payload)) };
  await assert.rejects(publishContext(dirty, { token: 'fixture-token', confirmPublication: true }), error => error.code === 'DIRTY_PUBLICATION');
});
