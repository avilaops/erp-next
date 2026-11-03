import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFiscalContract } from '../check-contract.mjs';

function contract() {
  const response = { content: { 'application/json': { schema: { $ref: '#/components/schemas/EmissionSnapshot' } } } };
  const paths = {};
  for (const [path, method] of [['readiness', 'get'], ['nfe/{id}', 'get'], ['nfe', 'post'],
    ['nfe/{id}/issue', 'post'], ['nfe/{id}/consult', 'post'], ['nfe/{id}/emission', 'get'], ['nfe/{id}/xml', 'get'], ['danfe', 'post']]) {
    const parameters = [{ name: 'X-Tenant-Id', in: 'header', required: true }];
    if (method === 'post' && path !== 'danfe') parameters.push({ name: 'Idempotency-Key', in: 'header', required: true });
    if (path.endsWith('/issue') || path.endsWith('/consult')) parameters.push({ name: 'If-Match', in: 'header', required: true });
    paths[`/api/v1/fiscal/${path}`] = { [method]: { security: [{ bearerAuth: [] }], parameters,
      responses: { 200: response, 201: response, 202: response } } };
  }
  paths['/api/v1/fiscal/nfe/{id}/xml'].get.responses[200] = { content: { 'application/xml': {} } };
  paths['/api/v1/fiscal/danfe'].post.responses[200] = { content: { 'application/pdf': {} } };
  return { openapi: '3.1.0', paths, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: {
    EmissionSnapshot: { type: 'object', required: ['tenantId', 'id', 'revision', 'status', 'environment'], properties: {} },
  } } };
}

test('contract gate rejects missing commands, auth, revision and asynchronous responses', () => {
  assert.equal(verifyFiscalContract(contract()).operations, 8);
  const changes = [
    doc => { delete doc.paths['/api/v1/fiscal/nfe/{id}/issue']; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/issue'].post.security = []; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/issue'].post.security = [{}, { bearerAuth: [] }]; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/consult'].post.parameters = []; },
    doc => { delete doc.paths['/api/v1/fiscal/nfe/{id}/issue'].post.responses[202]; },
    doc => { doc.components.schemas.EmissionSnapshot.required = ['id']; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/emission'].get.responses = { 204: { description: 'empty' } }; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/emission'].get.responses[200] = { content: { 'text/plain': {} } }; },
    doc => { doc.paths['/api/v1/fiscal/nfe/{id}/emission'].get.responses[200] = { content: { 'application/json': { schema: { type: 'object', required: ['id'] } } } }; },
    doc => { doc.paths['/api/v1/fiscal/readiness'].get.responses[200] = { content: { 'text/plain': {} } }; },
    doc => { doc.paths['/api/v1/fiscal/danfe'].post.responses[200] = { content: { 'text/plain': {} } }; },
  ];
  for (const change of changes) {
    const doc = contract(); change(doc);
    assert.throws(() => verifyFiscalContract(doc), /fiscal_contract:/);
  }
});

test('contract gate reports undeclared tenant headers instead of fabricating them', () => {
  const doc = contract();
  doc.paths['/api/v1/fiscal/nfe/{id}/emission'].get.parameters = [];
  assert.deepEqual(verifyFiscalContract(doc).tenantHeaderNotDeclared, ['GET /api/v1/fiscal/nfe/{id}/emission']);
});
