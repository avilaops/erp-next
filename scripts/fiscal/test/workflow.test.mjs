import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import workflow from '../n8n-workflow.mjs';

const tenantId = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const input = { id, revision: 1, idempotencyKey: id, confirm: true };
const vars = { ERP_FISCAL_API_URL: 'https://erp-api.example.com', ERP_FISCAL_TENANT_ID: tenantId, ERP_FISCAL_ALLOW_WRITES: 'true' };

function run(name, json, previous, config = vars) {
  const node = workflow.nodes.find(n => n.name === name);
  return runInNewContext(`(function() { ${node.parameters.jsCode} })()`, {
    $input: { all: () => [{ json }], first: () => ({ json }) }, $vars: config,
    $: () => ({ first: () => ({ json: previous }), item: { json: previous } }),
  })[0].json;
}

test('workflow validates a single explicit command and gets endpoint/tenant from operator configuration', () => {
  const command = run('Validate', input);
  assert.equal(command.apiBaseUrl, 'https://erp-api.example.com');
  assert.equal(command.tenantId, tenantId);
  assert.equal(command.idempotencyKey, id);
  for (const invalid of [{ ...input, confirm: false }, { ...input, id: '../config' }, { ...input, revision: 0 }]) {
    assert.throws(() => run('Validate', invalid));
  }
  assert.throws(() => run('Validate', input, null, { ...vars, ERP_FISCAL_ALLOW_WRITES: 'false' }));
  const upper = 'ABCDEFAB-1234-4000-8000-ABCDEFABCDEF';
  const normalized = run('Validate', { ...input, id: upper }, null, { ...vars, ERP_FISCAL_TENANT_ID: upper });
  assert.equal(normalized.id, upper.toLowerCase());
  assert.equal(normalized.tenantId, upper.toLowerCase());
});

test('workflow treats duplicate delivery as the same command and 202 as pending', () => {
  const command = run('Validate', input);
  const duplicate = run('Validate', { ...input });
  assert.equal(command.idempotencyKey, duplicate.idempotencyKey);
  const pending = run('Issue result', { statusCode: 202, body: { id, tenantId, status: 'unknown', environment: 'homologation' } }, command);
  assert.equal(pending.complete, false);
  assert.equal(pending.shouldPoll, true);
  assert.equal(pending.status, 'unknown');
});

test('workflow stops polling at limit and distinguishes authorization, rejection and HTTP failure', () => {
  const command = { ...run('Validate', input), attempts: 5 };
  const response = status => ({ statusCode: 200, body: { id, tenantId, status, environment: 'homologation' } });
  const pending = run('Poll result', response('unknown'), command);
  assert.equal(pending.shouldPoll, false);
  assert.equal(pending.needsAttention, true);
  const authorized = run('Poll result', response('authorized'), command);
  assert.equal(authorized.complete, true);
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.shouldPoll, false);
  const rejected = run('Poll result', response('rejected'), command);
  assert.equal(rejected.authorized, false);
  assert.equal(rejected.needsAttention, true);
  for (const statusCode of [401, 403, 409, 412, 429, 503]) {
    const error = run('Issue result', { statusCode, body: { secret: 'no-leak' } }, command);
    assert.equal(error.shouldPoll, false);
    assert.equal(error.needsAttention, true);
    assert.doesNotMatch(JSON.stringify(error), /no-leak/);
  }
  const otherTenant = response('authorized');
  otherTenant.body.tenantId = id;
  assert.throws(() => run('Poll result', otherTenant, command), /invalid_snapshot/);
});

test('workflow uses authenticated HTTP nodes, no automatic retry, and no production trigger', () => {
  assert.equal(workflow.active, false);
  const http = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.httpRequest');
  for (const node of http) {
    assert.equal(node.parameters.authentication, 'genericCredentialType');
    assert.equal(node.parameters.genericAuthType, 'oAuth2Api');
    assert.equal(node.retryOnFail, false);
    assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
  }
  assert.equal(workflow.nodes.filter(node => node.type.endsWith('Trigger')).length, 1);
});
