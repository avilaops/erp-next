import { runtimeConfiguration } from './runtime-configuration.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function unavailable(request) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    ok: false, status: 'maintenance', message: 'Aplicação temporariamente indisponível.',
  }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' } });
}
const cancelled = () => new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });

export function createRuntimeClass(Base, { sleep = pause, attempts = 30 } = {}) {
  return class ErpRuntimeController extends Base {
    constructor(ctx, env) { super(ctx, env); this.preparing = null; this.ready = false; }

    async prepare(configuration) {
      const container = this.ctx.container;
      const image = container?.images?.base;
      if (!container || typeof image !== 'string' || !/@sha256:[a-f0-9]{64}$/.test(image)) throw Error('Missing pinned runtime');
      if (container.running) {
        const active = await container.inspect();
        if (active?.image !== image) throw Error('Different running image requires an explicit rollout');
        if (this.ready) return;
      } else {
        this.ready = false;
        container.start({ image, instance: 'basic', enableInternet: true,
          env: configuration.containerEnvironment });
      }
      await container.setInactivityTimeout(120000);
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const api = await container.getTcpPort(8080).fetch(new Request('http://container/health/ready',
            { signal: AbortSignal.timeout(1500) }));
          const status = api.status === 200 ? await api.json() : null;
          if (api.status !== 200 && api.body) await api.body.cancel();
          if (status?.status === 'ready') {
            const web = await container.getTcpPort(3000).fetch(new Request('http://container/entrar',
              { signal: AbortSignal.timeout(1500) }));
            if (web.body) await web.body.cancel();
            if (web.status === 200) { this.ready = true; return; }
          }
        } catch { /* Retry readiness GETs only; no user command has been sent. */ }
        if (attempt + 1 < attempts) await sleep(500);
      }
      throw Error('Runtime is not ready');
    }

    async fetch(request) {
      const configuration = runtimeConfiguration(this.env);
      if (!configuration) return unavailable(request);
      if (request.signal.aborted) return cancelled();
      try {
        if (!this.preparing) this.preparing = this.prepare(configuration).finally(() => { this.preparing = null; });
        await this.preparing;
        if (request.signal.aborted) return cancelled();
        // Preserve original headers, stream, cookies and response. Never retry a
        // forwarded request: the API owns idempotency and uncertain outcomes.
        return await this.ctx.container.getTcpPort(3000).fetch(request);
      } catch {
        this.ready = false;
        return unavailable(request);
      }
    }
  };
}

export async function routeRuntimeRequest(request, env) {
  if (!runtimeConfiguration(env) || !env.ERP_RUNTIME) return unavailable(request);
  if (request.signal.aborted) return cancelled();
  try {
    const id = env.ERP_RUNTIME.idFromName('primary');
    return await env.ERP_RUNTIME.get(id).fetch(request);
  } catch {
    return unavailable(request);
  }
}
