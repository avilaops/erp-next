import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { localOrigin, probe } from '../probes.mjs';
import { testDatabase, execute, assertHarnessPortsAvailable } from '../suites.mjs';
import { html } from '../report.mjs';

test('network and database targets are explicit loopback origins and reject external or credential-bearing targets', () => {
  assert.equal(localOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const value of ['https://example.com', 'http://127.0.0.1.example.com', 'http://user:secret@localhost:8080', 'http://localhost/a', 'http://localhost/?token=secret', 'file:///a']) assert.throws(() => localOrigin(value));
  assert.throws(() => testDatabase());
  assert.throws(() => testDatabase('postgres://test@db.example.com/postgres'));
  assert.throws(() => testDatabase('postgres://test@127.0.0.1/erp_next'));
  assert.throws(() => testDatabase('postgres://test@127.0.0.1/postgres?host=example.com'));
  assert.equal(testDatabase('postgres://test@127.0.0.1:55400/postgres'), 'postgres://test@127.0.0.1:55400/postgres');
});

test('GET probes do not follow redirects or equate HTTP 200 with an approved business flow', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push([request.method, request.url, request.headers.authorization]);
    if (request.url === '/api/v1/protected') response.writeHead(401).end('{}');
    else if (request.url === '/api/v1/open') response.writeHead(200).end('{}');
    else if (request.url === '/health/ready') response.writeHead(503).end('{}');
    else if (request.url === '/redirect') response.writeHead(302, { Location: '/do-not-follow' }).end();
    else response.writeHead(200).end('<html>synthetic</html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await probe(origin, { kind: 'api', path: '/api/v1/protected', expected: 'anonymous_denied' })).verdict, 'passed');
    assert.equal((await probe(origin, { kind: 'api', path: '/api/v1/open', expected: 'anonymous_denied' })).verdict, 'failed');
    assert.equal((await probe(origin, { kind: 'api', path: '/health/ready', expected: 'public_status' })).verdict, 'inconclusive');
    assert.equal((await probe(origin, { kind: 'web', path: '/page', expected: 'http_observation_only' })).verdict, 'inconclusive');
    assert.equal((await probe(origin, { kind: 'web', path: '/redirect', expected: 'http_observation_only' })).status, 302);
    assert.ok(requests.every(([method, , token]) => method === 'GET' && !token));
    assert.ok(!requests.some(([, url]) => url === '/do-not-follow'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('suite logs redact known secrets and a failed process cannot become passed', async () => {
  const secret = 'synthetic-secret-verification-only';
  const result = await execute(process.execPath, ['-e', 'console.log(process.env.TEST_SECRET);process.exit(3)'], { root: process.cwd(), env: { ...process.env, TEST_SECRET: secret }, timeoutMs: 5000 });
  assert.equal(result.verdict, 'failed'); assert.equal(result.exitCode, 3);
  assert.ok(result.log.includes('[REDACTED_SECRET]')); assert.ok(!result.log.includes(secret));
});

test('occupied harness ports are detected without terminating the process that owns them', async () => {
  const server = createServer((request, response) => response.end('synthetic fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(assertHarnessPortsAvailable([port]), /indisponível/);
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assertHarnessPortsAvailable([port]);
});

test('a port-conflicted process is inconclusive instead of a business failure', async () => {
  const result = await execute(process.execPath, ['-e', 'console.error("Error: listen EADDRINUSE");process.exit(1)'], { root: process.cwd(), env: process.env, timeoutMs: 5000 });
  assert.equal(result.verdict, 'inconclusive'); assert.equal(result.exitCode, 1);
});

test('the HTML report escapes source-controlled strings instead of executing them', () => {
  const payload = '</script><script>alert(1)</script>';
  const report = { runId: 'fixture', startedAt: 'fixture', inventory: { sourceHash: 'a', pages: [{ path: payload, module: 'fixture', staticLinks: [], emptyActions: [], file: 'fixture' }], bff: [], api: [], browserTests: [] }, sourceHashAfter: 'a', runtime: [], suites: [], findings: [], ml: { status: 'insufficient_history' } };
  const output = html(report);
  assert.ok(!output.includes(payload)); assert.ok(output.includes('&lt;/script&gt;'));
  assert.ok(output.includes('Sem verificação individual associada'));
});
