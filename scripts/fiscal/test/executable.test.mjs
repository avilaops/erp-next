import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { main } from '../example.mjs';
import workflow from '../n8n-workflow.mjs';

const id = '00000000-0000-4000-8000-000000000001';

test('CLI validates output flags before any command can emit a document', async () => {
  assert.match((await main(['--help'], {})).usage, /consult/);
  await assert.rejects(main(['issue', '--id', id, '--output', 'invalid.pdf'], {}), /output_only_for_documents/);
});

test('SDK stdio client reads fiscal status through the HTTP adapter', async t => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.url, `/api/v1/fiscal/nfe/${id}/emission`);
    assert.equal(req.headers['x-tenant-id'], id);
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tenantId: id, id, revision: 2, status: 'authorized', environment: 'homologation' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))],
    env: { ERP_FISCAL_API_URL: `http://127.0.0.1:${server.address().port}`,
      ERP_FISCAL_TOKEN: 'fixture-token', ERP_FISCAL_TENANT_ID: id }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-integration-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const result = await client.callTool({ name: 'fiscal_nfe_status', arguments: { id } });
  assert.equal(result.structuredContent.data.status, 'authorized');
  assert.equal(calls, 1);
});

test('importable workflow matches the executable definition', async () => {
  const artifact = JSON.parse(await readFile(new URL('../../../docs/integrations/n8n-fiscal-homologation.json', import.meta.url), 'utf8'));
  assert.deepEqual(artifact, workflow);
});

test('n8n expressions produce a quoted ETag and bounded document routes', () => {
  const context = { id, tenantId: id, revision: 7, idempotencyKey: id, apiBaseUrl: 'https://api.example.com' };
  const issue = workflow.nodes.find(node => node.name === 'Issue');
  const evaluate = expression => Function('$json', `return (${expression.slice(3, -2)});`)(context);
  const headers = Object.fromEntries(issue.parameters.headerParameters.parameters.map(({ name, value }) => [name, evaluate(value)]));
  assert.equal(headers['If-Match'], '"7"');
  assert.equal(headers['Idempotency-Key'], id);
  assert.equal(evaluate(issue.parameters.url), `https://api.example.com/api/v1/fiscal/nfe/${id}/issue`);
});
