import { performance } from 'node:perf_hooks';

export function localOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use uma origem loopback explícita, sem credenciais, caminho, query ou fragmento.');
  }
  return url.origin;
}

async function readBounded(response, maximum) {
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); return { size, truncated: true }; }
    }
  }
  return { size, truncated: false };
}

export async function probe(origin, route, { timeoutMs = 4000 } = {}) {
  const base = localOrigin(origin);
  const concrete = route.path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
  const started = performance.now();
  const result = { id: `${route.kind}:GET:${route.path}`, environment: base, path: route.path, method: 'GET', expected: route.expected,
    verdict: 'inconclusive', durationMs: 0, responseBytes: null, status: null, reason: '' };
  try {
    const response = await fetch(base + concrete, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: route.kind === 'web' ? 'text/html' : 'application/json' } });
    result.status = response.status;
    const body = await readBounded(response, 2 * 1024 * 1024);
    result.responseBytes = body.size;
    if (body.truncated) { result.reason = 'Resposta excede o limite; corpo descartado e verificação inconclusiva.'; }
    else if (route.expected === 'anonymous_denied') {
      result.verdict = response.status === 401 ? 'passed' : 'failed';
      result.reason = response.status === 401 ? 'Acesso anônimo recusado; não comprova acesso autenticado, permissão ou persistência.' : 'A rota empresarial não devolveu o 401 esperado para acesso anônimo.';
    } else if (route.kind === 'web') {
      result.verdict = response.status >= 500 || response.status === 404 ? 'failed' : 'inconclusive';
      result.reason = 'Somente resposta HTTP observada; tela, ações e autenticação exigem teste de navegador.';
    } else if (route.path === '/health/ready' && response.status === 503) {
      result.reason = 'API respondeu sem prontidão do banco; ambiente não disponível para este teste.';
    } else {
      result.verdict = response.status === 200 ? 'passed' : 'failed'; result.reason = 'Verificação limitada ao status HTTP deste endpoint público.';
    }
  } catch {
    result.reason = 'Origem indisponível, timeout ou falha de transporte; não classificado como defeito da regra de negócio.';
  }
  result.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return result;
}

export async function runProbes(inventory, { apiOrigin, webOrigin }) {
  const results = [];
  if (apiOrigin) {
    localOrigin(apiOrigin);
    for (const route of inventory.api.filter(item => item.methods.includes('GET'))) {
      results.push(await probe(apiOrigin, { kind: 'api', path: route.path, expected: route.path.startsWith('/api/v1/') ? 'anonymous_denied' : 'public_status' }));
    }
  }
  if (webOrigin) {
    localOrigin(webOrigin);
    for (const route of inventory.pages.filter(item => !item.path.includes('['))) results.push(await probe(webOrigin, { kind: 'web', path: route.path, expected: 'http_observation_only' }));
  }
  return results;
}
