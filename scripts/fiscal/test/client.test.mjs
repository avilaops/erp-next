import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FiscalClient, FiscalError } from '../client.mjs';

const tenantId = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const idempotencyKey = '00000000-0000-4000-8000-000000000003';

async function fixture(t, handler, options = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    handler(req, res, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return {
    requests,
    client: new FiscalClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'secret-test-token', tenantId, ...options }),
  };
}

test('commands preserve tenant, revision and command UUID on repeated requests', async t => {
  const { client, requests } = await fixture(t, (_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json', etag: '"2"' });
    res.end(JSON.stringify({ id, tenantId, revision: 2, status: 'unknown', environment: 'homologation' }));
  }, { allowWrites: true });
  const args = { id, revision: 1, idempotencyKey, confirm: true };
  assert.equal((await client.issue(args)).status, 202);
  await client.issue(args);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].headers.authorization, 'Bearer secret-test-token');
  assert.equal(requests[0].headers['x-tenant-id'], tenantId);
  assert.equal(requests[0].headers['if-match'], '"1"');
  assert.equal(requests[0].headers['idempotency-key'], idempotencyKey);
  assert.equal(requests[0].url, `/api/v1/fiscal/nfe/${id}/issue`);
});

test('writes require operator opt-in, confirmation and valid immutable inputs', async t => {
  const { client, requests } = await fixture(t, () => assert.fail('no HTTP expected'));
  await assert.rejects(client.issue({ id, revision: 1, idempotencyKey, confirm: true }), /writes_disabled/);
  const enabled = new FiscalClient({ baseUrl: 'https://example.com', tenantId, token: 'token', allowWrites: true });
  for (const args of [
    { id, revision: 1, idempotencyKey },
    { id: '../config', revision: 1, idempotencyKey, confirm: true },
    { id, revision: -1, idempotencyKey, confirm: true },
    { id, revision: 1, idempotencyKey: 'new-key', confirm: true },
  ]) await assert.rejects(enabled.issue(args), /confirmation_required|invalid_/);
  assert.equal(requests.length, 0);
});

test('HTTP failures retain status/type/request id without exposing response secrets', async t => {
  const { client, requests } = await fixture(t, (_req, res) => {
    res.writeHead(412, { 'content-type': 'application/problem+json', 'x-request-id': 'req-1' });
    res.end(JSON.stringify({ type: 'https://erp.avilaops.com/problems/revision_conflict', title: 'secret-test-token', secret: 'certificate-secret' }));
  });
  await assert.rejects(client.status({ id }), error => {
    assert.ok(error instanceof FiscalError);
    assert.equal(error.status, 412);
    assert.equal(error.code, 'revision_conflict');
    assert.equal(error.requestId, 'req-1');
    assert.doesNotMatch(JSON.stringify(error), /secret-test-token|certificate-secret/);
    return true;
  });
  assert.equal(requests.length, 1);
});

test('redirects are refused and credentials never reach their target', async t => {
  const { client, requests } = await fixture(t, (_req, res) => {
    res.writeHead(302, { location: '/stolen' }); res.end();
  });
  await assert.rejects(client.status({ id }), /http_302/);
  assert.equal(requests.length, 1);
});

test('202 and nonterminal snapshots never become authorization; polling stops at its bound', async t => {
  const { client, requests } = await fixture(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id, tenantId, environment: 'homologation', status: 'unknown' }));
  });
  const result = await client.wait({ id, attempts: 2, intervalMs: 0 });
  assert.equal(result.complete, false);
  assert.equal(result.status, 'unknown');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.method === 'GET'));
});

test('polling stops for rejection and validates bounds before network', async t => {
  const { client, requests } = await fixture(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id, tenantId, status: 'rejected', environment: 'homologation' }));
  });
  assert.equal((await client.wait({ id, attempts: 3, intervalMs: 0 })).status, 'rejected');
  assert.equal(requests.length, 1);
  for (const attempts of [0, 1000, NaN]) await assert.rejects(client.wait({ id, attempts }), /invalid_attempts/);
});

test('XML and PDF use the existing routes and binary representation', async t => {
  const { client, requests } = await fixture(t, (req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/xml'); res.end('<nfeProc/>');
    } else {
      res.setHeader('content-type', 'application/pdf'); res.end('%PDF-test');
    }
  });
  const xml = await client.xml({ id });
  assert.equal(xml.data, '<nfeProc/>');
  const pdf = await client.pdf({ id });
  assert.equal(Buffer.from(pdf.data, 'base64').toString(), '%PDF-test');
  assert.equal(requests[2].url, '/api/v1/fiscal/danfe');
  assert.deepEqual(JSON.parse(requests[2].body), { xml: '<nfeProc/>' });
});

test('responses are bounded and nonlocal plaintext endpoints rejected', async t => {
  assert.throws(() => new FiscalClient({ baseUrl: 'http://example.com', tenantId, token: 'token' }), /invalid_base_url/);
  assert.throws(() => new FiscalClient({ baseUrl: 'https://user:pass@example.com', tenantId, token: 'token' }), /invalid_base_url/);
  const { client } = await fixture(t, (_req, res) => res.end('x'.repeat(2048)), { maxBytes: 1024 });
  await assert.rejects(client.status({ id }), /response_too_large/);
});

test('UUIDs are normalized before comparing API snapshots', async t => {
  const tenant = 'abcdefab-1234-4000-8000-abcdefabcdef';
  const { client } = await fixture(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: tenant, tenantId: tenant, status: 'authorized', environment: 'homologation' }));
  }, { tenantId: tenant.toUpperCase() });
  assert.equal((await client.wait({ id: tenant.toUpperCase(), attempts: 1 })).complete, true);
});
