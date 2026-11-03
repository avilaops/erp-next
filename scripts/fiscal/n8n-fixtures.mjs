import { pathToFileURL } from 'node:url';

// Synthetic transport fixtures. They are not ERP documents or SEFAZ evidence.
const id = '00000000-0000-4000-8000-000000000002';
const tenantId = '00000000-0000-4000-8000-000000000001';
const input = { id, revision: 1, idempotencyKey: '00000000-0000-4000-8000-000000000003', confirm: true };
const config = { apiBaseUrl: 'https://api.example.com', tenantId, allowWrites: true };
const response = (status, statusCode = 200) => ({ statusCode, headers: {}, body: { id, tenantId, revision: 2, status, environment: 'homologation' } });

export function scenarioPins(scenario = 'pending_then_authorized') {
  const cases = {
    authorized: [response('authorized'), response('authorized')],
    pending_then_authorized: [response('unknown', 202), response('authorized')],
    rejected: [response('rejected'), response('rejected')],
    forbidden: [{ statusCode: 403, headers: {}, body: { type: 'https://erp.avilaops.com/problems/forbidden' } }, response('unknown')],
    exhausted: [response('unknown', 202), response('unknown')],
  };
  if (!Object.hasOwn(cases, scenario)) throw new Error('invalid_scenario');
  const [issue, status] = cases[scenario];
  return { Input: [{ json: input }], Config: [{ json: config }], Issue: [{ json: issue }], Status: [{ json: status }] };
}

export function nodeSample(name) {
  const pending = { ...config, ...input, attempts: 0, status: 'unknown', revision: 2,
    httpStatus: 202, complete: false, authorized: false, shouldPoll: true, needsAttention: false };
  const samples = { Input: input, Config: config, Validate: { ...config, ...input, attempts: 0 },
    Issue: response('unknown', 202), Status: response('authorized'), 'Issue result': pending,
    Pending: pending, Wait: pending, 'Poll result': { ...pending, attempts: 1, status: 'authorized', httpStatus: 200, complete: true, authorized: true, shouldPoll: false },
    Result: { id, tenantId, status: 'authorized', revision: 2, attempts: 1, httpStatus: 200, complete: true, authorized: true, needsAttention: false } };
  return samples[name];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(JSON.stringify(scenarioPins(process.argv[2]), null, 2));
