import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../../deploy/cloudflare/edge-worker.mjs';

const RELEASE = 'fa7e1526a7c469843f1a18168ea5c0e558768ac1';
const PATH = '/_next/static/chunks/app/main-ab12.js';
const KEY = `releases/${RELEASE}/_next/static/chunks/app/main-ab12.js`;
const ETAG = '"b1946ac92492d2347c6235b4d2611184"';
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');

for (const [pathname, contentType] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml']]) {
  test(`public search metadata ${pathname} is available in maintenance without APP, R2 or cache I/O`, async () => {
    const f = fixture();
    const expected = await readFile(new URL(`../../apps/web/public${pathname}`, import.meta.url), 'utf8');
    const response = await f.fetch(`${pathname}?private=never-reflect`, { headers: { Cookie: 'session=secret' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), new RegExp(contentType));
    assert.equal(await response.text(), expected);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(f.calls.r2, []);
    assert.deepEqual(f.calls.matches, []);
    const head = await f.fetch(pathname, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    const post = await f.fetch(pathname, { method: 'POST', body: 'private' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  });
}

test('sitemap only advertises the public ERP access page and robots keep private paths excluded', async () => {
  const f = fixture();
  const xml = await (await f.fetch('/sitemap.xml')).text();
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ['https://erp.avilaops.com/entrar']);
  const robots = await (await f.fetch('/robots.txt')).text();
  assert.match(robots, /^Disallow: \/$/m);
  assert.match(robots, /^Allow: \/entrar\$$/m);
  assert.match(robots, /^Sitemap: https:\/\/erp\.avilaops\.com\/sitemap\.xml$/m);
  for (const path of ['/api/orders', '/cadastros/produtos', '/vendas/pedidos', '/servicos/contratos']) {
    assert.equal((await f.fetch(path)).status, 503);
  }
});
afterEach(() => originalCaches ? Object.defineProperty(globalThis, 'caches', originalCaches) : delete globalThis.caches);

function fixture(overrides = {}) {
  const calls = { r2: [], matches: [], puts: [] };
  const stored = new Map();
  const metadata = { key: KEY, version: '1', size: 8, etag: ETAG.slice(1, -1), httpEtag: ETAG,
    uploaded: new Date('2026-11-13T00:00:00Z'), httpMetadata: { contentType: 'text/html', cacheControl: 'private', contentDisposition: 'attachment' }, customMetadata: {}, checksums: {} };
  const object = () => ({ ...metadata, body: new Blob(['asset();']).stream(),
    arrayBuffer() { throw Error('buffering forbidden'); }, text() { throw Error('buffering forbidden'); } });
  const env = { ASSET_RELEASE: RELEASE, ASSET_CACHE_SECONDS: '60', APP_MODE: 'maintenance',
    PUBLIC_ASSETS: {
      async get(...args) { calls.r2.push(['get', ...args]); return object(); },
      async head(...args) { calls.r2.push(['head', ...args]); return metadata; },
    }, ...overrides };
  const cache = {
    async match(request) { calls.matches.push(request); return stored.get(request.url)?.clone(); },
    async put(request, response) {
      calls.puts.push({ request, status: response.status, headers: new Headers(response.headers) });
      const bytes = await response.arrayBuffer();
      stored.set(request.url, new Response(bytes, response));
    },
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: cache } });
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  return { env, calls, cache, stored, ctx, async drain() { await Promise.all(pending); },
    fetch(path = PATH, init = {}) { return worker.fetch(new Request(`https://erp.avilaops.com${path}`, init), env, ctx); } };
}

test('GET streams the exact release key with fixed public headers, ignoring uploaded HTTP metadata', async () => {
  const f = fixture();
  const response = await f.fetch(`${PATH}?token=secret`, { headers: { Cookie: 'session=secret', Authorization: 'Bearer secret' } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset();');
  assert.equal(response.headers.get('Content-Type'), 'application/javascript; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, immutable');
  assert.equal(response.headers.get('ETag'), ETAG);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Content-Disposition'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(f.calls.r2, [['get', KEY]]);
  await f.drain();
  assert.equal(f.calls.puts.length, 1);
  assert.equal(f.calls.puts[0].status, 200);
  for (const key of [...f.calls.matches, ...f.calls.puts.map(x => x.request)]) {
    assert.equal(key.method, 'GET');
    assert.equal(key.url, `https://erp.avilaops.com/releases/${RELEASE}${PATH}`);
    assert.deepEqual([...key.headers], []);
  }
});

test('GET cache hit avoids R2; HEAD reuses GET metadata without body or a second cache write', async () => {
  const f = fixture();
  await (await f.fetch()).text();
  await f.drain();
  assert.equal(await (await f.fetch(`${PATH}?different=1`)).text(), 'asset();');
  const head = await f.fetch(PATH, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('Content-Length'), '8');
  assert.equal(f.calls.r2.length, 1);
  assert.equal(f.calls.puts.length, 1);
});

test('uncached HEAD reads only R2 metadata and never stores an empty GET response', async () => {
  const f = fixture();
  const response = await f.fetch(PATH, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.deepEqual(f.calls.r2, [['head', KEY]]);
  assert.equal(f.calls.puts.length, 0);
});

for (const value of [ETAG, `W/${ETAG}`, `"unrelated", W/${ETAG}`, '*']) {
  test(`If-None-Match ${value} returns 304 with no body on cold and warm cache`, async () => {
    const f = fixture();
    const cold = await f.fetch(PATH, { headers: { 'If-None-Match': value } });
    assert.equal(cold.status, 304);
    assert.equal(cold.body, null);
    assert.equal(cold.headers.get('ETag'), ETAG);
    assert.equal(cold.headers.get('Content-Length'), null);
    assert.equal(f.calls.puts.length, 0);
    await (await f.fetch()).text();
    await f.drain();
    const warm = await f.fetch(PATH, { headers: { 'If-None-Match': value } });
    assert.equal(warm.status, 304);
    assert.equal(warm.body, null);
    assert.equal(f.calls.r2.length, 2);
  });
}

test('nonmatching ETag returns the asset; release changes cannot reuse previous cache', async () => {
  const f = fixture();
  assert.equal(await (await f.fetch(PATH, { headers: { 'If-None-Match': '"other"' } })).text(), 'asset();');
  await f.drain();
  f.env.ASSET_RELEASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(await (await f.fetch()).text(), 'asset();');
  await f.drain();
  assert.deepEqual(f.calls.r2, [['get', KEY], ['get', 'releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/_next/static/chunks/app/main-ab12.js']]);
});

for (const [extension, type] of Object.entries({ css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml', wasm: 'application/wasm' })) {
  test(`allowlisted .${extension} receives a fixed type`, async () => {
    const response = await fixture().fetch(`/_next/static/media/example.${extension}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    await response.text();
  });
}

for (const path of [
  '/_next/static/main.js.map', '/_next/static/index.html', '/_next/static/dump.sql', '/_next/static/data.json',
  '/_next/static/js', '/_next/static/toString', '/_next/static/__proto__',
  '/_next/static/.secret.js', '/_next/static//main.js', '/_next/static/main.JS', '/_next/static/main.js/',
  '/_next/static/%2e%2e/private.sql', '/_next/static/a%2fb.js', '/_next/static/a%5cb.js',
  '/_next/static/%252e%252e/x.js', '/_next/static/a%00.js', '/_next/static/a%ZZ.js',
  `/_next/static/${'x'.repeat(2049)}.js`, '/_next/static/',
]) {
  test(`rejects unsafe asset path without R2/cache: ${path.slice(0, 85)}`, async () => {
    const f = fixture();
    const response = await f.fetch(path);
    assert.ok([404, 503].includes(response.status));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(f.calls.r2, []);
    assert.deepEqual(f.calls.matches, []);
    assert.deepEqual(f.calls.puts, []);
  });
}

for (const path of ['/files/invoice.pdf', '/backups/db.sql.gz', `/releases/${RELEASE}${PATH}`, '/api/orders', '/oauth/callback', '/login', '/']) {
  test(`dynamic/private route ${path} stays unavailable without cache/storage access`, async () => {
    const f = fixture();
    const response = await f.fetch(path, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(f.calls.r2, []);
    assert.deepEqual(f.calls.matches, []);
  });
}

test('maintenance health is honestly unhealthy JSON, including HEAD', async () => {
  const f = fixture();
  const response = await f.fetch('/api/health', { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.equal((await response.json()).ok, false);
  const head = await f.fetch('/api/health', { method: 'HEAD' });
  assert.equal(head.status, 503);
  assert.equal(head.body, null);
});

test('maintenance navigation receives bounded HTML and API gets JSON regardless of Accept', async () => {
  const f = fixture();
  const html = await f.fetch('/', { headers: { Accept: 'text/html' } });
  assert.match(html.headers.get('Content-Type'), /text\/html/);
  assert.match(await html.text(), /indisponível/i);
  const api = await f.fetch('/api/orders', { method: 'POST', body: 'secret' });
  assert.equal(api.status, 503);
  assert.equal((await api.json()).ok, false);
  assert.deepEqual(f.calls.matches, []);
});

for (const [name, values] of Object.entries({ ASSET_RELEASE: ['', RELEASE.toUpperCase(), 'abc', `${RELEASE}/bad`, null],
  ASSET_CACHE_SECONDS: ['', '59', '31536001', '1e3', '60.5', ' 60', '60x', '-60', null, NaN, Infinity, true],
  APP_MODE: ['', 'unknown', 'APPLICATION', null] })) {
  for (const value of values) test(`invalid ${name}=${String(value)} fails closed before I/O`, async () => {
    const f = fixture({ [name]: value });
    const response = await f.fetch();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(f.calls.r2, []);
    assert.deepEqual(f.calls.matches, []);
  });
}

test('production TTL is seconds, and missing mode safely defaults to maintenance', async () => {
  const f = fixture({ ASSET_CACHE_SECONDS: '31536000', APP_MODE: undefined });
  const response = await f.fetch();
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  await response.text();
  assert.equal((await f.fetch('/')).status, 503);
});

test('non-GET/HEAD assets cannot reach R2, cache or future APP', async () => {
  let appCalls = 0;
  const f = fixture({ APP_MODE: 'application', APP: { fetch() { appCalls++; return new Response('unexpected'); } } });
  const response = await f.fetch(PATH, { method: 'POST', body: 'sensitive' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(f.calls.r2, []);
  assert.deepEqual(f.calls.matches, []);
  assert.equal(appCalls, 0);
});

test('R2 not-found and errors are noncached with no retry', async () => {
  for (const kind of ['missing', 'failure']) {
    let calls = 0;
    const f = fixture({ PUBLIC_ASSETS: { async get() { calls++; if (kind === 'failure') throw Error('secret'); return null; } } });
    const response = await f.fetch();
    assert.equal(response.status, kind === 'missing' ? 404 : 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(calls, 1);
    assert.equal(f.calls.puts.length, 0);
    assert.doesNotMatch(await response.text(), /secret/);
  }
});

test('cache read/write failures are best effort, with no unhandled rejection or invalid cached response', async () => {
  const f = fixture();
  f.cache.match = async () => { throw Error('read failed'); };
  f.cache.put = async () => { throw Error('write failed'); };
  const response = await f.fetch();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset();');
  await f.drain();
  f.cache.match = async () => new Response('poison', { status: 503 });
  assert.equal(await (await f.fetch()).text(), 'asset();');
  await f.drain();
});

test('response is available before an unfinished R2 stream completes', async () => {
  const f = fixture();
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  f.env.PUBLIC_ASSETS.get = async () => ({ size: 2, httpEtag: ETAG, body });
  const response = await f.fetch();
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  controller.enqueue(new Uint8Array([65]));
  assert.deepEqual((await reader.read()).value, new Uint8Array([65]));
  controller.enqueue(new Uint8Array([66]));
  controller.close();
  assert.deepEqual((await reader.read()).value, new Uint8Array([66]));
  assert.equal((await reader.read()).done, true);
  await f.drain();
});

test('a cache consumer that never reads cannot block or buffer the client stream', { timeout: 2000 }, async () => {
  const f = fixture();
  f.cache.put = async (_request, response) => {
    await assert.rejects(response.body.getReader().closed);
  };
  const response = await f.fetch();
  assert.equal(await response.text(), 'asset();');
  await f.drain();
});

test('build route groups and dynamic chunk names stay readable', async () => {
  const f = fixture();
  const response = await f.fetch('/_next/static/chunks/app/(dashboard)/orders/[id]/page-ab12.js');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset();');
  assert.deepEqual(f.calls.r2, [['get', `releases/${RELEASE}/_next/static/chunks/app/(dashboard)/orders/[id]/page-ab12.js`]]);
  await f.drain();
});

test('maintenance never reads a command body or calls a configured APP', async () => {
  const f = fixture({ APP: { fetch() { assert.fail('maintenance called APP'); } } });
  const request = new Request('https://erp.avilaops.com/api/payments', { method: 'POST', body: 'private command' });
  for (const method of ['text', 'json', 'arrayBuffer', 'clone']) request[method] = () => { assert.fail(`maintenance called ${method}`); };
  const response = await worker.fetch(request, f.env, f.ctx);
  assert.equal(response.status, 503);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(f.calls.r2, []);
  assert.deepEqual(f.calls.matches, []);
});

test('HEAD failures have no body and are not cached or retried', async () => {
  for (const missing of [true, false]) {
    let calls = 0;
    const f = fixture({ PUBLIC_ASSETS: { async head() { calls++; if (!missing) throw Error('unavailable'); return null; } } });
    const response = await f.fetch(PATH, { method: 'HEAD' });
    assert.equal(response.status, missing ? 404 : 503);
    assert.equal(response.body, null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(calls, 1);
    assert.equal(f.calls.puts.length, 0);
  }
});

test('cache absent or synchronously broken still serves a valid asset', async () => {
  const f = fixture();
  delete globalThis.caches;
  assert.equal(await (await f.fetch()).text(), 'asset();');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    match() { throw Error('synchronous cache failure'); },
    put() { throw Error('synchronous cache failure'); },
  } } });
  assert.equal(await (await f.fetch()).text(), 'asset();');
  await f.drain();
});

test('client cancellation cancels the R2 reader and abandons its cache copy', { timeout: 2000 }, async () => {
  const f = fixture();
  let reason;
  f.env.PUBLIC_ASSETS.get = async () => ({ size: 1, httpEtag: ETAG, body: new ReadableStream({ cancel(value) { reason = value; } }) });
  const response = await f.fetch();
  await response.body.cancel('client disconnected');
  assert.equal(reason, 'client disconnected');
  await f.drain();
});

test('stream source failure cannot leave a partial successful cache entry', { timeout: 2000 }, async () => {
  const f = fixture();
  f.env.PUBLIC_ASSETS.get = async () => ({ size: 1, httpEtag: ETAG, body: new ReadableStream({ pull(controller) { controller.error(Error('source failed')); } }) });
  const response = await f.fetch();
  await assert.rejects(response.text(), /source failed/);
  await f.drain();
  assert.equal(f.stored.size, 0);
});

test('application passes the original streamed POST once and preserves status and cookies', async () => {
  const f = fixture({ APP_MODE: 'application' });
  const request = new Request('https://erp.avilaops.com/api/payments?state=secret', { method: 'POST',
    body: new Blob(['command']).stream(), duplex: 'half', headers: { Cookie: 'session=secret', Authorization: 'Bearer secret' } });
  let calls = 0;
  const result = new Response('rejected', { status: 409, headers: { 'WWW-Authenticate': 'Bearer' } });
  result.headers.append('Set-Cookie', 'session=renewed; HttpOnly');
  result.headers.append('Set-Cookie', 'csrf=second; Secure');
  f.env.APP = { async fetch(actual) {
    calls++;
    assert.equal(actual, request);
    assert.equal(actual.bodyUsed, false);
    assert.equal(actual.headers.get('Cookie'), 'session=secret');
    assert.equal(actual.headers.get('Authorization'), 'Bearer secret');
    assert.equal(await actual.text(), 'command');
    return result;
  } };
  const response = await worker.fetch(request, f.env, f.ctx);
  assert.equal(response, result);
  assert.equal(response.status, 409);
  assert.deepEqual(response.headers.getSetCookie(), ['session=renewed; HttpOnly', 'csrf=second; Secure']);
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  assert.equal(calls, 1);
  assert.deepEqual(f.calls.matches, []);
  assert.deepEqual(f.calls.r2, []);
});

test('missing or failing APP returns 503 and never replays a command', async () => {
  for (const missing of [true, false]) {
    let calls = 0;
    const f = fixture({ APP_MODE: 'application', APP: missing ? undefined : { async fetch(request) {
      calls++; await request.text(); throw Error('private app detail');
    } } });
    const response = await f.fetch('/api/payments', { method: 'POST', body: 'command' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private app detail/);
    assert.equal(calls, missing ? 0 : 1);
    assert.deepEqual(f.calls.matches, []);
    assert.deepEqual(f.calls.r2, []);
  }
});

test('resource declaration binds only public builds and starts safely with a 60-second canary', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../deploy/cloudflare/resources.json', import.meta.url), 'utf8'));
  assert.equal(manifest.account_id, '85b914dcdebf6fa2fce7b819bc542294');
  assert.equal(manifest.zone_id, 'f892de4ea80c3ae2cf2dbc0c1ccf54dd');
  assert.equal(manifest.hostname, 'erp.avilaops.com');
  assert.deepEqual(manifest.buckets.map(x => [x.name, x.public]), [
    ['avilaops-erp-next-assets', false], ['avilaops-erp-next-files', false], ['avilaops-erp-next-backups', false],
  ]);
  assert.equal(manifest.worker.name, 'erp-next-edge');
  assert.equal(manifest.worker.main, 'edge-worker.mjs');
  assert.equal(manifest.worker.compatibility_date, '2026-11-13');
  assert.equal(manifest.worker.workers_dev, true);
  assert.deepEqual(manifest.worker.bindings, [{ type: 'r2_bucket', name: 'PUBLIC_ASSETS', bucket_name: 'avilaops-erp-next-assets' }]);
  assert.deepEqual(manifest.worker.vars, { ASSET_RELEASE: RELEASE, ASSET_CACHE_SECONDS: '60', APP_MODE: 'maintenance' });
  assert.equal(manifest.production.ASSET_CACHE_SECONDS, '31536000');
  const obs = manifest.worker.observability;
  assert.equal(obs.enabled, true);
  assert.equal(obs.redact_query_string, true);
  assert.equal(obs.logs.enabled, true);
  assert.equal(obs.logs.invocation_logs, false);
  assert.equal(obs.traces.enabled, true);
  for (const signal of [obs.logs, obs.traces]) assert.ok(signal.head_sampling_rate > 0 && signal.head_sampling_rate <= 1);
  assert.deepEqual(manifest.route, { pattern: 'erp.avilaops.com/*', zone_id: 'f892de4ea80c3ae2cf2dbc0c1ccf54dd', enabled: false });
  const f = fixture(manifest.worker.vars);
  assert.equal((await f.fetch('/api/health')).status, 503);
  const response = await f.fetch();
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, immutable');
  await response.text();
});
