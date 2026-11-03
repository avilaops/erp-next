import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { workflowSdk } from '../n8n-sdk.mjs';
import definition from '../n8n-workflow.mjs';

test('SDK export preserves privacy settings, node parameters and both polling branches', () => {
  const nodes = [];
  const links = [];
  let settings;
  const buildNode = value => {
    nodes.push(value);
    return { name: value.config.name,
      input: index => ({ name: value.config.name, index }),
      output: output => ({ to: target => ({ source: value.config.name, output, target: target.name, input: target.index }) }),
    };
  };
  const builder = { add(connection) { links.push(connection); return this; }, group() { return this; } };
  runInNewContext(`(function() { ${workflowSdk().replace('export default', 'return')} })()`, {
    node: buildNode, trigger: buildNode, ifElse: buildNode, expr: value => `=${value}`,
    workflow: (_id, _name, options) => { settings = options?.settings; return builder; },
  });
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.ok(settings, 'workflow settings must be passed to the SDK factory');
  assert.deepEqual(plain(settings), { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false });
  assert.equal(nodes.length, 10);
  for (const node of nodes) assert.deepEqual(plain(node.config.parameters), definition.nodes.find(item => item.name === node.config.name).parameters);
  assert.deepEqual(plain(links.filter(link => link.source === 'Pending')), [
    { source: 'Pending', output: 0, target: 'Wait', input: 0 },
    { source: 'Pending', output: 1, target: 'Result', input: 0 },
  ]);
  assert.ok(links.some(link => link.source === 'Poll result' && link.target === 'Pending'));
});
