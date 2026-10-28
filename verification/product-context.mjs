import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizedRoute } from './discovery.mjs';

const definitionSchema = JSON.parse(await readFile(new URL('./schemas/product-flow-definitions.schema.json', import.meta.url), 'utf8'));
const contextSchema = JSON.parse(await readFile(new URL('./schemas/product-context.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDefinitions = ajv.compile(definitionSchema);
const validateContext = ajv.compile(contextSchema);

export function stableJson(value) {
  const ordered = item => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
  return JSON.stringify(ordered(value), null, 2) + '\n';
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const sorted = values => [...new Set(values)].sort();

export function validateProductContext(value) {
  if (!validateContext(value)) return (validateContext.errors || []).map(error => ({ code: 'invalid_product_context_schema', path: error.instancePath, detail: error.message }));
  const { contentSha256, ...payload } = value;
  return sha256(stableJson(payload)) === contentSha256 ? [] : [{ code: 'context_digest_mismatch', path: '/contentSha256', detail: 'O conteúdo não corresponde ao hash declarado.' }];
}

export function validateProductFlows(catalogue) {
  const definitions = catalogue.productFlows;
  if (!validateDefinitions(definitions)) return (validateDefinitions.errors || []).map(error => ({ code: 'invalid_product_flow_schema', path: error.instancePath, detail: error.message }));
  const findings = [];
  const fail = (code, flow, detail) => findings.push({ code, path: flow, detail });
  const groups = new Set(catalogue.actions.map(action => action.flow));
  const ids = new Set(), owners = new Map();
  const actions = new Map(catalogue.actions.map(action => [action.id, action]));
  const auth = new Set(catalogue.authActions.map(action => `${action.method} ${action.path}`));
  for (const flow of definitions.flows) {
    if (ids.has(flow.id)) fail('duplicate_product_flow', flow.id, 'Identidade de funcionalidade repetida.');
    ids.add(flow.id);
    for (const group of flow.actionGroups) {
      if (!groups.has(group)) fail('unknown_action_group', flow.id, `Grupo não encontrado: ${group}`);
      if (owners.has(group)) fail('duplicate_action_group_owner', flow.id, `Grupo já associado a ${owners.get(group)}: ${group}`);
      owners.set(group, flow.id);
    }
    const steps = new Set();
    for (const step of flow.journey || []) {
      if (steps.has(step.id)) fail('duplicate_journey_step', flow.id, `Etapa repetida: ${step.id}`);
      steps.add(step.id);
      if (!step.actionIds.length && !step.authRefs.length && !step.externalSystems.length) fail('unbound_journey_step', flow.id, `Etapa sem ação ou sistema: ${step.id}`);
      for (const id of step.actionIds) if (!actions.has(id)) fail('unknown_journey_action', flow.id, `Ação não encontrada: ${id}`);
      for (const ref of step.authRefs) if (!auth.has(ref)) fail('unknown_auth_operation', flow.id, `Operação de autenticação não encontrada: ${ref}`);
    }
  }
  for (const group of groups) if (!owners.has(group)) fail('unowned_action_group', group, 'Grupo de ações sem funcionalidade associada.');
  const flows = new Map(definitions.flows.map(flow => [flow.id, flow]));
  for (const flow of definitions.flows) for (const dependency of flow.dependencies) {
    if (!flows.has(dependency)) fail('unknown_flow_dependency', flow.id, `Dependência não encontrada: ${dependency}`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { fail('cyclic_flow_dependency', id, 'Dependências circulares não permitem preparar o contexto.'); return; }
    if (visited.has(id) || !flows.has(id)) return;
    visiting.add(id);
    for (const dependency of flows.get(id).dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  if (findings.length) return findings;
  for (const flow of definitions.flows) {
    const allowedGroups = new Set();
    const included = new Set();
    function include(id) { if (included.has(id)) return; included.add(id); const current = flows.get(id); for (const group of current.actionGroups) allowedGroups.add(group); for (const dependency of current.dependencies) include(dependency); }
    include(flow.id);
    for (const step of flow.journey || []) for (const id of step.actionIds) {
      if (!allowedGroups.has(actions.get(id).flow)) fail('undeclared_journey_dependency', flow.id, `A ação ${id} exige uma dependência explícita.`);
    }
  }
  return findings;
}

export function selectProductFlows(catalogue, target) {
  const findings = validateProductFlows(catalogue);
  if (findings.length) throw new Error(findings.map(item => `${item.code}: ${item.path}: ${item.detail}`).join('\n'));
  const flows = new Map(catalogue.productFlows.flows.map(flow => [flow.id, flow]));
  if (target && !flows.has(target)) throw new Error(`Funcionalidade não encontrada: ${target}`);
  const included = new Set();
  function add(id) { if (included.has(id)) return; included.add(id); for (const dependency of flows.get(id).dependencies) add(dependency); }
  if (target) add(target); else for (const id of flows.keys()) add(id);
  return [...included].sort().map(id => flows.get(id));
}

export function contextSourcePaths(catalogue, inventory, definitions) {
  const groups = new Set(definitions.flatMap(flow => flow.actionGroups));
  const actions = catalogue.actions.filter(action => groups.has(action.flow));
  const paths = new Set([
    'verification/contracts.json', 'verification/product-context.mjs', 'verification/product-context-cli.mjs', 'verification/product-context-mcp.mjs',
    'verification/schemas/product-flow-definitions.schema.json', 'verification/schemas/product-context.schema.json',
    'verification/mcp/central-tools.json',
    'package.json', 'pnpm-lock.yaml', 'Cargo.toml', 'Cargo.lock', 'apps/api/Cargo.toml', 'apps/web/package.json',
    ...definitions.flatMap(flow => flow.additionalSources || []),
  ]);
  for (const action of actions) {
    for (const file of action.sources) paths.add(file);
    if (action.input.body) paths.add(action.input.body.source);
    for (const page of action.ui.pages) {
      for (const item of inventory.pages.filter(item => normalizedRoute(item.path) === normalizedRoute(page))) {
        paths.add(item.file);
        for (const dependency of item.dependencies || []) paths.add(dependency);
      }
    }
    if (action.ui.bff) for (const handler of inventory.bff) {
      if (normalizedRoute(handler.path) === normalizedRoute(action.ui.bff.path)) paths.add(handler.file);
    }
  }
  for (const auth of catalogue.authActions) for (const handler of inventory.bff) {
    if (normalizedRoute(handler.path) === normalizedRoute(auth.path) && handler.methods.includes(auth.method)) paths.add(handler.file);
  }
  return [...paths].sort();
}

export function buildProductContext(catalogue, inventory, source, target = null) {
  const definitions = selectProductFlows(catalogue, target);
  const groups = new Set(definitions.flatMap(flow => flow.actionGroups));
  const actions = catalogue.actions.filter(action => groups.has(action.flow)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const flows = definitions.map(definition => {
    const owned = actions.filter(action => definition.actionGroups.includes(action.flow));
    const pages = sorted(owned.flatMap(action => action.ui.pages));
    const mapped = owned.filter(action => action.ui.pages.length && action.ui.bff
      && action.ui.pages.every(page => inventory.pages.some(item => normalizedRoute(item.path) === normalizedRoute(page)))
      && inventory.bff.some(handler => normalizedRoute(handler.path) === normalizedRoute(action.ui.bff.path) && handler.methods.includes(action.ui.bff.method)));
    return {
      definition,
      definitionState: definition.journey ? 'journey_defined' : 'actions_mapped',
      actionIds: owned.map(action => action.id),
      pages,
      permissions: sorted(owned.flatMap(action => action.permissions)),
      assessment: {
        code: { implementedDeclarations: owned.filter(action => action.status === 'implemented').length, blockedDeclarations: owned.filter(action => action.status === 'blocked').length },
        interface: { state: mapped.length === owned.length ? 'routes_mapped' : mapped.length ? 'partially_mapped' : 'not_mapped', mappedActionIds: mapped.map(action => action.id), unmappedActionIds: owned.filter(action => !mapped.includes(action)).map(action => action.id) },
        publication: 'not_observed',
        execution: 'not_observed',
      },
    };
  });
  const payload = {
    schemaVersion: 'erp-product-context/1', product: 'erp',
    source,
    selection: { targetFlow: target, includedFlows: definitions.map(flow => flow.id) },
    flows, actions,
    authActions: catalogue.authActions,
    pendingFlows: [...catalogue.pendingFlows].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    limits: [
      'Metadados, relações e declarações de implementação extraídos do catálogo e das fontes locais.',
      'Página e BFF mapeados não comprovam interação, persistência ou execução do fluxo.',
      'Publicação e execução não são inferidas do commit, de nomes de arquivos ou do catálogo.',
      'As fontes de contexto incluem referências do catálogo e dependências TypeScript resolvidas estaticamente; não são um grafo completo de dependências Rust ou de execução.',
      'Nenhum modelo de ML foi executado para produzir este contexto.',
    ],
  };
  const result = { ...payload, contentSha256: sha256(stableJson(payload)) };
  const findings = validateProductContext(result);
  if (findings.length) throw new Error(`Contexto inválido: ${findings.map(item => `${item.path}: ${item.detail}`).join(', ')}`);
  return result;
}

export function contextMarkdown(context) {
  const lines = ['# Contexto de funcionalidades do ERP', '', `Commit: \`${context.source.commit}\` · Checkout com alterações: ${context.source.dirty ? 'sim' : 'não'}.`, '',
    `Seleção: ${context.selection.targetFlow || 'todas'} · ${context.flows.length} funcionalidades · ${context.actions.length} ações · ${context.pendingFlows.length} grupos com decisões pendentes.`, '',
    'Este artefato descreve fontes e contratos. Publicação e execução permanecem não observadas.', ''];
  for (const flow of context.flows) {
    const item = flow.definition;
    lines.push(`## ${item.title}`, '', item.goal, '', `Identidade: \`${item.id}\`. Dependências: ${item.dependencies.join(', ') || 'nenhuma declarada'}.`, '',
      `Definição: ${flow.definitionState}. Interface: ${flow.assessment.interface.state}.`, '',
      `Telas referenciadas: ${flow.pages.map(page => `\`${page}\``).join(', ') || 'nenhuma declarada'}.`, '',
      `Permissões referenciadas: ${flow.permissions.map(code => `\`${code}\``).join(', ') || 'nenhuma declarada'}.`, '',
      `Próximo passo: ${item.nextStep}`, '', '**Ações e fontes**', '');
    for (const id of flow.actionIds) {
      const action = context.actions.find(action => action.id === id);
      lines.push(`- \`${action.operation.method} ${action.operation.path}\` — ${action.response.action} (${action.status}).`);
      for (const file of action.sources) lines.push(`  - Fonte: \`${file}\`.`);
    }
    if (item.journey) {
      lines.push('', '**Sequência definida**', '');
      item.journey.forEach((step, index) => lines.push(`${index + 1}. ${step.title}`));
    }
    lines.push('');
  }
  lines.push('## Decisões pendentes', '');
  for (const pending of context.pendingFlows) lines.push(`- ${pending.title}: ${pending.openDecisions.join(' ')}`);
  return lines.join('\n') + '\n';
}
