import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runtimeConfiguration, childEnvironments } from '../../deploy/cloudflare/runtime-configuration.mjs';
import { createRuntimeClass, routeRuntimeRequest } from '../../deploy/cloudflare/runtime-core.mjs';
import { startSupervisor } from '../../deploy/cloudflare/runtime-supervisor.mjs';

const SHA = 'a'.repeat(40);
const IMAGE = `registry.cloudflare.com/account/erp-runtime@sha256:${'b'.repeat(64)}`;
const environment = () => ({
  RUNTIME_MODE: 'application', ERP_SOURCE_SHA: SHA, ERP_ACTIVATION_SOURCE_SHA: SHA,
  ERP_RECOVERY_VERIFIED: 'true', ERP_AUTH_VERIFIED: 'true',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DATABASE_URL: 'postgresql://erp_next_app:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full',
  AUTH_ISSUER: 'https://auth.example.invalid', AUTH_USERINFO_URL: 'https://auth.example.invalid/oauth/userinfo',
  ERP_WEB_ORIGIN: 'https://erp.example.invalid', ERP_AUTH_CLIENT_ID: 'erp',
  ERP_AUTH_CLIENT_SECRET: 'client-secret', ERP_SESSION_SECRET: 's'.repeat(40),
  ERP_BACKGROUND_WORKERS_ENABLED: 'false',
});

test('activation requires exact source, recovered data, auth and safe database identity', () => {
  assert.ok(runtimeConfiguration(environment()));
  for (const change of [
    { RUNTIME_MODE: 'maintenance' }, { ERP_RECOVERY_VERIFIED: 'false' },
    { ERP_AUTH_VERIFIED: 'false' }, { ERP_ACTIVATION_SOURCE_SHA: 'c'.repeat(40) },
    { DATABASE_URL: environment().DATABASE_URL.replace('erp_next_app:', 'postgres:') },
    { DATABASE_URL: environment().DATABASE_URL.replace('verify-full', 'disable') },
    { DATABASE_URL: environment().DATABASE_URL.replace(':5432/', ':6543/') },
    { DATABASE_URL: environment().DATABASE_URL.replace('.supabase.co', '.supabase.co.evil.invalid') },
    { ERP_SESSION_SECRET: 'short' }, { AUTH_ISSUER: 'http://auth.example.invalid' },
    { ERP_WEB_ORIGIN: 'https://erp.example.invalid/subpath' },
  ]) assert.equal(runtimeConfiguration({ ...environment(), ...change }), null);
});

test('only required runtime secrets reach each process, with private loopback API', () => {
  const env = { ...environment(), DATABASE_MIGRATION_URL: 'ADMIN', SUPABASE_SERVICE_ROLE_KEY: 'PRIVILEGED',
    CLOUDFLARE_API_TOKEN: 'CF', NODE_OPTIONS: '--inspect=0.0.0.0', SMTP_PASSWORD: 'MAIL',
    ERP_API_URL: 'https://wrong.invalid', API_BIND_ADDRESS: '0.0.0.0:9999' };
  const split = childEnvironments(env);
  assert.equal(split.api.API_BIND_ADDRESS, '127.0.0.1:8080');
  assert.equal(split.web.ERP_API_URL, 'http://127.0.0.1:8080');
  assert.equal(split.web.PORT, '3000');
  assert.equal(split.api.SMTP_PASSWORD, 'MAIL');
  assert.equal(split.web.SMTP_PASSWORD, undefined);
  assert.equal(split.api.ERP_SESSION_SECRET, undefined);
  assert.equal(split.web.DATABASE_URL, undefined);
  for (const part of Object.values(split)) for (const key of ['DATABASE_MIGRATION_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDFLARE_API_TOKEN', 'NODE_OPTIONS']) assert.equal(part[key], undefined);
});

function fixture(overrides = {}) {
  const calls = [], starts = [], env = environment();
  const container = {
    running: false, images: { base: IMAGE },
    start(options) { starts.push(options); this.running = true; },
    async inspect() { return { image: IMAGE }; },
    async setInactivityTimeout(value) { calls.push({ idle: value }); },
    getTcpPort(port) { return { fetch: async request => {
      calls.push({ port, request });
      if (port === 8080) return Response.json({ status: 'ready' });
      if (new URL(request.url).pathname === '/entrar') return new Response('Login');
      return new Response(request.body, { status: 201, headers: { 'Set-Cookie': 'test=value; HttpOnly' } });
    } }; }, ...overrides,
  };
  class Base { constructor(ctx, environment) { this.ctx = ctx; this.env = environment; } }
  const Runtime = createRuntimeClass(Base, { sleep: async () => {}, attempts: 2 });
  const object = new Runtime({ container }, env);
  env.ERP_RUNTIME = { idFromName: name => name, get: () => object };
  return { calls, starts, env, object, container };
}

test('inactive Worker never starts or calls any container', async () => {
  const f = fixture();
  f.env.RUNTIME_MODE = 'maintenance';
  const response = await routeRuntimeRequest(new Request('https://erp.example.invalid/api/health'), f.env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.starts.length, 0);
  assert.equal(f.calls.length, 0);
});

test('cold start waits for API and web, forwards original business stream exactly once', async () => {
  const f = fixture();
  const request = new Request('https://erp.example.invalid/api/erp/orders', {
    method: 'POST', body: 'original-order-body', headers: { Authorization: 'Bearer token',
      Cookie: 'session=private', 'Idempotency-Key': 'original-key' }, duplex: 'half',
  });
  const response = await routeRuntimeRequest(request, f.env);
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'original-order-body');
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  const forwarded = f.calls.filter(c => c.request?.method === 'POST');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].request, request);
  assert.equal(forwarded[0].request.headers.get('Idempotency-Key'), 'original-key');
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].image, IMAGE);
  assert.equal(f.starts[0].env.DATABASE_MIGRATION_URL, undefined);
});

test('concurrent cold requests share startup, with each request forwarded only once', async () => {
  const f = fixture();
  const requests = ['one', 'two'].map(body => new Request('https://erp.example.invalid/orders', { method: 'POST', body }));
  const responses = await Promise.all(requests.map(request => routeRuntimeRequest(request, f.env)));
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['one', 'two']);
  assert.equal(f.starts.length, 1);
  assert.equal(f.calls.filter(c => c.request?.method === 'POST').length, 2);
});

test('failed readiness never forwards a command, and errors disclose no credentials', async () => {
  const f = fixture({ getTcpPort: () => ({ fetch: async () => { throw Error('secret and client-secret'); } }) });
  const response = await routeRuntimeRequest(new Request('https://erp.example.invalid/orders', { method: 'POST', body: 'do-not-send' }), f.env);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('client-secret'), false);
  assert.equal(f.calls.filter(c => c.request?.method === 'POST').length, 0);
});

test('a forwarding failure is never retried or sent to an old origin', async () => {
  const f = fixture();
  let commands = 0;
  const ports = f.container.getTcpPort.bind(f.container);
  f.container.getTcpPort = port => ({ fetch: async request => {
    if (request.method === 'POST') { commands++; throw Error('uncertain command'); }
    return ports(port).fetch(request);
  } });
  const response = await routeRuntimeRequest(new Request('https://erp.example.invalid/orders', { method: 'POST', body: 'one' }), f.env);
  assert.equal(response.status, 503);
  assert.equal(commands, 1);
});

test('an already running different image is not destroyed or used', async () => {
  const f = fixture({ running: true, inspect: async () => ({ image: IMAGE.replace('b'.repeat(64), 'c'.repeat(64)) }) });
  const response = await routeRuntimeRequest(new Request('https://erp.example.invalid/orders'), f.env);
  assert.equal(response.status, 503);
  assert.equal(f.starts.length, 0);
  assert.equal(f.calls.length, 0);
});

test('aborted requests never dispatch a business command', async () => {
  const f = fixture(), abort = new AbortController();
  abort.abort();
  const response = await routeRuntimeRequest(new Request('https://erp.example.invalid/orders', { signal: abort.signal }), f.env);
  assert.equal(response.status, 499);
  assert.equal(f.starts.length, 0);
});

function supervisorFixture(fetchImpl = async () => Response.json({ status: 'ready' })) {
  const children = [], launches = [];
  function spawnProcess(command, args, options) {
    const child = new EventEmitter();
    child.kills = [];
    child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('exit', 0, signal)); };
    children.push(child); launches.push({ command, args, options });
    return child;
  }
  const supervisor = startSupervisor({ env: environment(), spawnProcess, fetchImpl,
    sleep: async () => {}, attempts: 2, shutdownMs: 20 });
  return { supervisor, children, launches };
}

test('supervisor starts API without migration and waits before spawning web', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = supervisorFixture(async () => { await gate; return Response.json({ status: 'ready' }); });
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.launches[0].args, []);
  assert.equal(f.launches[0].command, '/usr/local/bin/erp-next-api');
  release();
  await f.supervisor.ready;
  assert.equal(f.launches.length, 2);
  assert.deepEqual(f.launches[1].args, ['apps/web/server.js']);
  f.supervisor.stop();
  assert.equal(await f.supervisor.done, 0);
});

test('failed API readiness stops the native process and never starts web', async () => {
  const f = supervisorFixture(async () => new Response('', { status: 503 }));
  await assert.rejects(f.supervisor.ready);
  assert.equal(await f.supervisor.done, 1);
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.children[0].kills, ['SIGTERM']);
});

test('unexpected child exit terminates its sibling and produces a failed runtime', async () => {
  const f = supervisorFixture();
  await f.supervisor.ready;
  f.children[0].emit('exit', 1, null);
  assert.equal(await f.supervisor.done, 1);
  assert.deepEqual(f.children[1].kills, ['SIGTERM']);
});

test('graceful shutdown stops both processes without restart or migration', async () => {
  const f = supervisorFixture();
  await f.supervisor.ready;
  f.supervisor.stop();
  assert.equal(await f.supervisor.done, 0);
  assert.equal(f.launches.length, 2);
  assert.ok(f.children.every(child => child.kills.length === 1));
});
