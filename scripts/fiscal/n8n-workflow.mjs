import { pathToFileURL } from 'node:url';

// Keep executable Code-node logic alongside tests; export the resulting JSON for import.
const validate = `
const items = $input.all();
if (items.length !== 1) throw new Error('one_command_required');
const input = items[0].json;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if ($vars.ERP_FISCAL_ALLOW_WRITES !== 'true') throw new Error('writes_disabled');
if (input.confirm !== true) throw new Error('confirmation_required');
if (!uuid.test(input.id) || !uuid.test(input.idempotencyKey)) throw new Error('invalid_uuid');
if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('invalid_revision');
const apiBaseUrl = String($vars.ERP_FISCAL_API_URL || '').replace(/\\/$/, '');
if (!/^https:\\/\\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(apiBaseUrl)) throw new Error('invalid_api_url');
const tenantId = $vars.ERP_FISCAL_TENANT_ID;
if (!uuid.test(tenantId)) throw new Error('invalid_tenant');
return [{ json: { apiBaseUrl, tenantId: tenantId.toLowerCase(), id: input.id.toLowerCase(), revision: input.revision,
  idempotencyKey: input.idempotencyKey.toLowerCase(), attempts: 0 } }];
`;

function classify(previous, increment) {
  return `
const command = ${previous};
const response = $input.first().json;
const attempts = command.attempts + ${increment};
if (![200, 202].includes(response.statusCode)) return [{ json: {
  ...command, attempts, status: 'http_error', httpStatus: response.statusCode,
  complete: false, authorized: false, shouldPoll: false, needsAttention: true } }];
const body = response.body;
if (!body || body.id !== command.id || body.tenantId !== command.tenantId
    || body.environment !== 'homologation'
    || !['preparing', 'prepared', 'unknown', 'authorized', 'rejected', 'cancelled'].includes(body.status)) {
  throw new Error('invalid_snapshot');
}
const complete = ['authorized', 'rejected', 'cancelled'].includes(body.status);
const authorized = body.status === 'authorized';
const shouldPoll = !complete && attempts < 6;
return [{ json: { ...command, attempts, status: body.status, revision: body.revision,
  httpStatus: response.statusCode, complete, authorized, shouldPoll,
  needsAttention: !authorized && !shouldPoll } }];
`;
}

const options = {
  timeout: 180000,
  redirect: { redirect: { followRedirects: false } },
  response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
};
function http(name, method, url, headers, position) {
  return { id: name.toLowerCase().replaceAll(' ', '-'), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
    retryOnFail: false,
    parameters: { method, url, authentication: 'genericCredentialType', genericAuthType: 'oAuth2Api',
      sendHeaders: true, headerParameters: { parameters: headers }, options },
  };
}
function code(name, jsCode, position) {
  return { id: name.toLowerCase().replaceAll(' ', '-'), name, type: 'n8n-nodes-base.code', typeVersion: 2,
    position, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode } };
}
const edge = node => ({ node, type: 'main', index: 0 });

const workflow = {
  name: 'ERP Fiscal — emissão explícita em homologação (AVL-116)', active: false,
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false },
  nodes: [
    { id: 'input', name: 'Input', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1,
      position: [0, 0], parameters: { inputSource: 'passthrough' } },
    code('Validate', validate, [220, 0]),
    http('Issue', 'POST', '={{ $json.apiBaseUrl + "/api/v1/fiscal/nfe/" + $json.id + "/issue" }}', [
      { name: 'X-Tenant-Id', value: '={{ $json.tenantId }}' },
      { name: 'If-Match', value: '={{ "\\\"" + $json.revision + "\\\"" }}' },
      { name: 'Idempotency-Key', value: '={{ $json.idempotencyKey }}' },
    ], [440, 0]),
    code('Issue result', classify("$('Validate').first().json", 0), [660, 0]),
    { id: 'pending', name: 'Pending', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [880, 0],
      parameters: { conditions: { combinator: 'and', options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'pending', leftValue: '={{ $json.shouldPoll }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {} } },
    { id: 'wait', name: 'Wait', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1100, -100],
      parameters: { resume: 'timeInterval', amount: 10, unit: 'seconds' } },
    http('Status', 'GET', '={{ $json.apiBaseUrl + "/api/v1/fiscal/nfe/" + $json.id + "/emission" }}', [
      { name: 'X-Tenant-Id', value: '={{ $json.tenantId }}' },
    ], [1320, -100]),
    code('Poll result', classify("$('Wait').item.json", 1), [1540, -100]),
    code('Result', `const { id, tenantId, status, httpStatus, revision, attempts, complete, authorized, needsAttention } = $input.first().json;
return [{ json: { id, tenantId, status, httpStatus, revision, attempts, complete, authorized, needsAttention } }];`, [1100, 140]),
  ],
  connections: {
    Input: { main: [[edge('Validate')]] }, Validate: { main: [[edge('Issue')]] },
    Issue: { main: [[edge('Issue result')]] }, 'Issue result': { main: [[edge('Pending')]] },
    Pending: { main: [[edge('Wait')], [edge('Result')]] }, Wait: { main: [[edge('Status')]] },
    Status: { main: [[edge('Poll result')]] }, 'Poll result': { main: [[edge('Pending')]] },
  },
};

export default workflow;
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(JSON.stringify(workflow, null, 2));
