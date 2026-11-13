const STATIC_PREFIX = '/_next/static/';
const TYPES = Object.freeze({
  js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  svg: 'image/svg+xml', wasm: 'application/wasm',
});

function configuration(env) {
  const mode = env.APP_MODE === undefined ? 'maintenance' : env.APP_MODE;
  const rawTTL = env.ASSET_CACHE_SECONDS;
  if (typeof env.ASSET_RELEASE !== 'string' || !/^[a-f0-9]{40}$/.test(env.ASSET_RELEASE)
    || !['maintenance', 'application'].includes(mode)
    || !['string', 'number'].includes(typeof rawTTL) || !/^\d+$/.test(String(rawTTL))) return null;
  const ttl = Number(rawTTL);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 31536000) return null;
  return { mode, ttl, release: env.ASSET_RELEASE };
}

function unavailable(request, pathname) {
  const json = pathname === '/api' || pathname.startsWith('/api/')
    || !request.headers.get('Accept')?.includes('text/html');
  const body = json ? JSON.stringify({ ok: false, status: 'maintenance', message: 'Aplicação temporariamente indisponível.' })
    : '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ERP indisponível</title><h1>ERP temporariamente indisponível</h1><p>Tente novamente em breve.</p></html>';
  return new Response(request.method === 'HEAD' ? null : body, { status: 503, headers: {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff',
  } });
}

function assetType(pathname) {
  if (pathname.length > 2048) return null;
  const segments = pathname.slice(STATIC_PREFIX.length).split('/');
  if (segments.length > 32 || segments.some(segment => segment.length > 255
    || !/^[A-Za-z0-9_()[\]@-][A-Za-z0-9_()[\]@.-]*$/.test(segment))) return null;
  const filename = segments.at(-1);
  if (!filename.includes('.')) return null;
  const extension = filename.split('.').at(-1);
  return Object.hasOwn(TYPES, extension) ? TYPES[extension] : null;
}

function errorResponse(request, status) {
  return new Response(request.method === 'HEAD' ? null : status === 404 ? 'Not found' : 'Method not allowed', {
    status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) },
  });
}

function matchesETag(request, etag) {
  const condition = request.headers.get('If-None-Match');
  return condition !== null && condition.length <= 8192
    && condition.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);
}

function assetHeaders(type, ttl, etag, size) {
  const headers = new Headers({ 'Content-Type': type, 'Cache-Control': `public, max-age=${ttl}, immutable`,
    ETag: etag, 'X-Content-Type-Options': 'nosniff' });
  if (size !== null) headers.set('Content-Length', String(size));
  return headers;
}

// Read only as the client pulls. Keep at most one pending cache chunk; a slow
// cache loses its copy rather than growing an unbounded Response.clone() tee.
function cacheWhileStreaming(source, cache, key, headers, ctx) {
  const reader = source.getReader();
  let cacheController;
  const copy = new ReadableStream({
    start(controller) { cacheController = controller; },
    cancel() { cacheController = null; },
  }, { highWaterMark: 1 });
  function abandonCache() {
    if (cacheController) cacheController.error(new Error('Cache copy abandoned'));
    cacheController = null;
  }
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (cacheController && cacheController.desiredSize <= 0) abandonCache();
        if (done) {
          if (cacheController) cacheController.close();
          cacheController = null;
          controller.close();
        } else {
          if (cacheController) cacheController.enqueue(value);
          controller.enqueue(value);
        }
      } catch (error) {
        abandonCache();
        controller.error(error);
      }
    },
    cancel(reason) { abandonCache(); return reader.cancel(reason); },
  }, { highWaterMark: 0 });
  // Promise.resolve also catches synchronous cache.put failures. No raw request
  // values, bodies, cookies, authorization, or query strings are logged.
  ctx.waitUntil(Promise.resolve().then(() => cache.put(key, new Response(copy, { headers }))).catch(abandonCache));
  return body;
}

async function serveAsset(request, env, ctx, url, config) {
  if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(request, 405);
  const type = assetType(url.pathname);
  if (!type) return errorResponse(request, 404);
  const storageKey = `releases/${config.release}${url.pathname}`;
  // Build a fresh GET key: no client headers, query, body, cookies or credentials.
  const cacheKey = new Request(`${url.origin}/${storageKey}`);
  let cache;
  try {
    cache = globalThis.caches?.default;
    const cached = await cache?.match(cacheKey);
    if (cached?.status === 200 && cached.headers.has('ETag')) {
      const notModified = matchesETag(request, cached.headers.get('ETag'));
      const headers = assetHeaders(type, config.ttl, cached.headers.get('ETag'), notModified ? null : cached.headers.get('Content-Length'));
      if (notModified || request.method === 'HEAD') {
        if (cached.body) ctx.waitUntil(cached.body.cancel().catch(() => {}));
        return new Response(null, { status: notModified ? 304 : 200, headers });
      }
      return new Response(cached.body, { headers });
    }
    if (cached?.body) ctx.waitUntil(cached.body.cancel().catch(() => {}));
  } catch {
    // Cache availability must never hide a valid R2 asset.
  }
  try {
    const object = await (request.method === 'HEAD' ? env.PUBLIC_ASSETS.head(storageKey) : env.PUBLIC_ASSETS.get(storageKey));
    if (!object) return errorResponse(request, 404);
    if (!Number.isSafeInteger(object.size) || object.size < 0 || typeof object.httpEtag !== 'string'
      || !/^"[^"\r\n]+"$/.test(object.httpEtag)) throw new Error('Invalid public asset metadata');
    const notModified = matchesETag(request, object.httpEtag);
    const headers = assetHeaders(type, config.ttl, object.httpEtag, notModified ? null : object.size);
    if (notModified || request.method === 'HEAD') {
      if (object.body) ctx.waitUntil(object.body.cancel().catch(() => {}));
      return new Response(null, { status: notModified ? 304 : 200, headers });
    }
    const body = cache ? cacheWhileStreaming(object.body, cache, cacheKey, headers, ctx) : object.body;
    return new Response(body, { headers });
  } catch {
    return unavailable(request, url.pathname);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const config = configuration(env);
    if (!config) return unavailable(request, url.pathname);
    if (url.pathname.startsWith(STATIC_PREFIX)) return serveAsset(request, env, ctx, url, config);
    if (config.mode === 'application' && env.APP) {
      try {
        // Preserve the original stream, method, cookies and response exactly.
        // A failed command is never retried, cloned, or sent to an origin.
        return await env.APP.fetch(request);
      } catch {
        return unavailable(request, url.pathname);
      }
    }
    return unavailable(request, url.pathname);
  },
};
