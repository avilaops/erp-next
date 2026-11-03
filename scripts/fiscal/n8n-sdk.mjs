import { pathToFileURL } from 'node:url';
import workflow from './n8n-workflow.mjs';
import { nodeSample } from './n8n-fixtures.mjs';

function literal(value) {
  if (typeof value === 'string' && value.startsWith('={{') && value.endsWith('}}')) return `expr(${JSON.stringify(value.slice(1))})`;
  if (Array.isArray(value)) return `[${value.map(literal).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${literal(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The SDK graph and importable JSON share the same nodes, parameters and edges. */
export function workflowSdk() {
  const names = new Map(workflow.nodes.map((item, index) => [item.name, `step${index}`]));
  const declarations = workflow.nodes.map(item => {
    const factory = item.type.endsWith('Trigger') ? 'trigger' : item.type === 'n8n-nodes-base.if' ? 'ifElse' : 'node';
    const config = { name: item.name, parameters: item.parameters, position: item.position,
      ...(item.retryOnFail === undefined ? {} : { retryOnFail: item.retryOnFail }) };
    return `const ${names.get(item.name)} = ${factory}({type:${JSON.stringify(item.type)},version:${item.typeVersion},config:${literal(config)},output:${literal([nodeSample(item.name)])}});`;
  });
  const connections = [];
  for (const [source, { main }] of Object.entries(workflow.connections)) {
    for (const [output, targets] of main.entries()) {
      for (const target of targets) connections.push(`.add(${names.get(source)}.output(${output}).to(${names.get(target.node)}.input(${target.index})))`);
    }
  }
  return `${declarations.join('\n')}\nexport default workflow('avl-116-fiscal',${JSON.stringify(workflow.name)},{settings:${literal(workflow.settings)}})\n${connections.join('\n')}\n.group('Emissão e acompanhamento',[${workflow.nodes.filter(item => item.name !== 'Input').map(item => names.get(item.name)).join(',')}],{description:'Valida configuração e comando, emite uma vez e acompanha estado com limite; não reconcilia na SEFAZ.'});\n`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(workflowSdk());
