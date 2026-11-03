import { setTimeout as delay } from 'node:timers/promises';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = new Set(['authorized', 'rejected', 'cancelled']);

export class FiscalError extends Error {
  constructor(code, { status = null, requestId = null } = {}) {
    super(code);
    this.name = 'FiscalError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
  toJSON() { return { code: this.code, status: this.status, requestId: this.requestId }; }
}

function check(condition, code) {
  if (!condition) throw new FiscalError(code);
}
function uuid(value, field) { check(typeof value === 'string' && UUID.test(value), `invalid_${field}`); return value.toLowerCase(); }

export class FiscalClient {
  constructor({ baseUrl, token, tenantId, allowWrites = false, timeoutMs = 180_000, maxBytes = 8 * 1024 * 1024 }) {
    let url;
    try { url = new URL(baseUrl); } catch { throw new FiscalError('invalid_base_url'); }
    check((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'invalid_base_url');
    check(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'invalid_token');
    check(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180_000, 'invalid_timeout');
    check(Number.isInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 16 * 1024 * 1024, 'invalid_max_bytes');
    this.baseUrl = url.origin;
    this.token = token;
    this.tenantId = uuid(tenantId, 'tenant_id');
    this.allowWrites = allowWrites === true;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  static fromEnv(env = process.env) {
    return new FiscalClient({ baseUrl: env.ERP_FISCAL_API_URL, token: env.ERP_FISCAL_TOKEN,
      tenantId: env.ERP_FISCAL_TENANT_ID, allowWrites: env.ERP_FISCAL_ALLOW_WRITES === 'true' });
  }

  async request(path, { method = 'GET', headers = {}, body, format = 'json' } = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/fiscal/${path}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.token}`, 'x-tenant-id': this.tenantId,
          accept: format === 'pdf' ? 'application/pdf' : format === 'xml' ? 'application/xml' : 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        check(size <= this.maxBytes, 'response_too_large');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const requestId = response.headers.get('x-request-id');
      if (!response.ok) {
        let code = `http_${response.status}`;
        try {
          const problem = JSON.parse(bytes.toString('utf8'));
          if (/^https:\/\/erp\.avilaops\.com\/problems\/[a-z0-9_]+$/.test(problem.type)) code = problem.type.split('/').at(-1);
        } catch { /* Error payloads are optional and never forwarded verbatim. */ }
        throw new FiscalError(code, { status: response.status, requestId });
      }
      const contentType = response.headers.get('content-type') ?? '';
      let data;
      if (format === 'pdf') {
        check(contentType.split(';')[0] === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-', 'invalid_pdf_response');
        data = bytes.toString('base64');
      } else if (format === 'xml') {
        check(/^(application|text)\/xml\b/.test(contentType), 'invalid_xml_response');
        data = bytes.toString('utf8');
      } else {
        check(contentType.includes('application/json'), 'invalid_json_response');
        try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new FiscalError('invalid_json_response'); }
        check(data && typeof data === 'object' && !Array.isArray(data), 'invalid_json_response');
        if ('tenantId' in data) check(data.tenantId === this.tenantId, 'tenant_mismatch');
      }
      return { status: response.status, etag: response.headers.get('etag'), requestId, contentType, data };
    } catch (error) {
      if (error instanceof FiscalError) throw error;
      throw new FiscalError(error?.name === 'TimeoutError' ? 'request_timeout' : 'transport_uncertain');
    }
  }

  readiness() { return this.request('readiness'); }
  draft({ id }) { return this.request(`nfe/${uuid(id, 'id')}`); }
  status({ id }) { return this.request(`nfe/${uuid(id, 'id')}/emission`); }
  xml({ id }) { return this.request(`nfe/${uuid(id, 'id')}/xml`, { format: 'xml' }); }
  async pdf({ id }) {
    const xml = await this.xml({ id });
    return this.request('danfe', { method: 'POST', body: { xml: xml.data }, format: 'pdf' });
  }

  commandHeaders({ revision, idempotencyKey, confirm }, needsRevision = true) {
    check(this.allowWrites, 'writes_disabled');
    check(confirm === true, 'confirmation_required');
    const headers = { 'idempotency-key': uuid(idempotencyKey, 'idempotency_key') };
    if (needsRevision) {
      check(Number.isSafeInteger(revision) && revision >= 1, 'invalid_revision');
      headers['if-match'] = `"${revision}"`;
    }
    return headers;
  }
  async createDraft({ input, ...command }) {
    const headers = this.commandHeaders(command, false);
    check(input && typeof input === 'object' && !Array.isArray(input), 'invalid_input');
    return this.request('nfe', { method: 'POST', headers, body: input });
  }
  async issue({ id, ...command }) {
    const headers = this.commandHeaders(command);
    return this.request(`nfe/${uuid(id, 'id')}/issue`, { method: 'POST', headers });
  }
  async consult({ id, ...command }) {
    const headers = this.commandHeaders(command);
    return this.request(`nfe/${uuid(id, 'id')}/consult`, { method: 'POST', headers });
  }
  async wait({ id, attempts = 6, intervalMs = 10_000 }) {
    id = uuid(id, 'id');
    check(Number.isInteger(attempts) && attempts >= 1 && attempts <= 30, 'invalid_attempts');
    check(Number.isInteger(intervalMs) && intervalMs >= 0 && intervalMs <= 60_000, 'invalid_interval');
    let result;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await delay(intervalMs);
      result = await this.status({ id });
      check(result.data.id === id && result.data.environment === 'homologation'
        && ['preparing', 'prepared', 'unknown', ...terminal].includes(result.data.status), 'invalid_snapshot');
      if (terminal.has(result.data.status)) return { complete: true, status: result.data.status, response: result };
    }
    return { complete: false, status: result.data.status, response: result };
  }
}
