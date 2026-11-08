import { normalizedRoute } from './discovery.mjs';
import { validateProductFlows } from './product-context.mjs';
import mcpProtocolActions from './mcp/protocol-actions.json' with { type: 'json' };

const dimensions = ['interface', 'request', 'authorization', 'domain', 'persistence', 'effects', 'failure', 'response'];
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const text = value => typeof value === 'string' && value.trim().length > 0;
const texts = value => Array.isArray(value) && value.every(text);
const key = operation => `${operation.method} ${normalizedRoute(operation.path)}`;

// This assesses the definition and static coverage of contracts. It never
// turns documentation, a matched route or an existing test file into a pass.
export function assessContracts(catalogue, inventory) {
  const findings = [];
  const fail = (code, target, detail) => findings.push({ severity: 'error', code, path: target || 'contracts', detail, evidence: ['verification/contracts.json'] });
  if (catalogue?.schemaVersion !== 'erp-action-contracts/1' || !Array.isArray(catalogue?.actions)
      || !Array.isArray(catalogue?.pendingFlows) || !Array.isArray(catalogue?.authActions) || !Array.isArray(catalogue?.dispatches)) {
    fail('invalid_contract_catalogue', 'contracts', 'Formato de catálogo incompatível ou coleções ausentes.');
    return { status: 'invalid', findings, runtimeVerdict: 'not_verified_by_catalog' };
  }
  const actions = [...catalogue.actions, ...(catalogue.actionsAppendix ?? [])];
  const api = new Set(inventory.api.flatMap(route => route.methods.map(method => key({ method, path: route.path }))));
  const bff = new Set(inventory.bff.flatMap(route => route.methods.map(method => key({ method, path: route.path }))));
  const pages = new Set(inventory.pages.map(page => normalizedRoute(page.path)));
  const covered = new Set(), coveredBff = new Set(), ids = new Set();
  for (const action of actions) {
    const operation = action?.operation;
    if (!text(action?.id) || ids.has(action.id)) fail('duplicate_or_missing_action_id', action?.id, 'Cada ação precisa de identidade única.');
    ids.add(action?.id);
    if (!operation || !methods.has(operation.method) || !text(operation.path) || !operation.path.startsWith('/')) {
      fail('invalid_action_operation', action?.id, 'Método e caminho explícitos são obrigatórios.'); continue;
    }
    const target = key(operation);
    if (covered.has(target)) fail('duplicate_action_operation', target, 'A operação foi definida mais de uma vez.');
    covered.add(target);
    if (!api.has(target)) fail('contract_without_api', target, 'O contrato aponta para uma operação ausente do inventário de produção.');
    if (!['implemented', 'blocked'].includes(action.status) || !text(action.actor) || !texts(action.permissions)
        || !texts(action.preconditions) || !action.preconditions.length || !text(action.transition?.from) || !text(action.transition?.to)
        || !texts(action.effects?.writes) || !texts(action.effects?.external) || !texts(action.effects?.excludes)
        || !text(action.recovery) || !texts(action.sources) || !action.sources.length
        || !texts(action.input?.headers) || !texts(action.input?.pathParameters)
        || typeof action.concurrency?.revision !== 'boolean' || typeof action.concurrency?.idempotency !== 'boolean'
        || !text(action.concurrency?.rule) || !text(action.response?.action)
        || !Array.isArray(action.response?.successStatuses) || !Array.isArray(action.response?.errorStatuses)
        || !texts(action.ui?.pages)) {
      fail('incomplete_action_contract', target, 'Faltam ator, entrada, autorização, estados, efeitos, resposta, concorrência, fonte ou recuperação.');
    }
    if (action.verification?.status !== 'not_verified_by_catalog'
        || !Array.isArray(action.verification?.criteria)
        || dimensions.some(dimension => !action.verification.criteria.includes(dimension))) {
      fail('contract_is_not_runtime_evidence', target, 'O catálogo precisa das oito dimensões e não pode declarar execução aprovada.');
    }
    if (action.status === 'blocked' && (action.response?.successStatuses?.length || action.effects?.writes?.length)) {
      fail('blocked_action_claims_success', target, 'Uma ação bloqueada não pode declarar sucesso ou escrita de negócio.');
    }
    for (const [flag, header] of [['revision', 'If-Match'], ['idempotency', 'Idempotency-Key']]) {
      if (action.concurrency?.[flag] !== action.input?.headers?.includes(header)) fail('contract_header_mismatch', target, `Precondição ${header} inconsistente com a ficha.`);
    }
    const requiredStatuses = action.concurrency?.revision ? [400, 412, 428] : action.concurrency?.idempotency ? [428] : [];
    if (requiredStatuses.some(status => !action.response?.errorStatuses?.includes(status))) {
      fail('missing_precondition_failure', target, 'Revisão/chave obrigatória precisa declarar as respostas de recusa correspondentes.');
    }
    if (action.input?.body && (!text(action.input.body.source) || !text(action.input.body.type))) fail('invalid_body_reference', target, 'O corpo precisa referenciar o tipo e a fonte reais.');
    for (const page of Array.isArray(action.ui?.pages) ? action.ui.pages : []) {
      if (!text(page) || !pages.has(normalizedRoute(page))) fail('contract_without_page', target, 'Página referenciada não encontrada.');
    }
    const proxy = action.ui?.bff;
    if (proxy) {
      if (!methods.has(proxy.method) || !text(proxy.path) || !bff.has(key(proxy))) {
        fail('contract_without_bff', target, 'Método/caminho BFF ausente.'); continue;
      }
      coveredBff.add(key(proxy));
      let expected = proxy.path.replace('/api/erp/', '/api/v1/').replace('[id]', '{id}');
      const dispatchParameter = proxy.path.includes('[format]') ? 'format' : 'action';
      if (proxy.path.includes(`[${dispatchParameter}]`)) {
        const dispatch = catalogue.dispatches.find(item => item?.path === proxy.path && item.method === proxy.method);
        const values = dispatchParameter === 'format' ? dispatch?.formats : dispatch?.actions;
        if (!text(proxy[dispatchParameter]) || !Array.isArray(values) || !values.includes(proxy[dispatchParameter])) fail('undefined_dispatch_action', target, 'Destino dinâmico não especificado no catálogo.');
        expected = expected.replace(`[${dispatchParameter}]`, proxy[dispatchParameter] || '');
      }
      if (proxy.path.includes('[...resource]')) {
        const dispatch = catalogue.dispatches.find(item => item?.path === proxy.path && item.method === proxy.method);
        if (!text(proxy.resource) || !Array.isArray(dispatch?.resources) || !dispatch.resources.includes(proxy.resource)) fail('undefined_dispatch_resource', target, 'Recurso de rota abrangente não especificado no catálogo.');
        expected = expected.replace('[...resource]', proxy.resource || '');
      }
      if (operation.method !== proxy.method || normalizedRoute(expected) !== normalizedRoute(operation.path)) fail('wrong_bff_target', target, 'O BFF declarado não corresponde à operação desta ficha.');
    }
  }
  const dispatchKeys = new Set();
  for (const dispatch of catalogue.dispatches) {
    const target = `${dispatch?.method} ${dispatch?.path}`;
    const catchAll = dispatch?.path?.includes('[...resource]');
    const format = dispatch?.path?.includes('[format]');
    const values = catchAll ? dispatch.resources : format ? dispatch.formats : dispatch?.actions;
    if (dispatchKeys.has(target) || !methods.has(dispatch?.method) || !text(dispatch?.path)
        || !bff.has(key(dispatch)) || !texts(values) || !values.length || new Set(values).size !== values.length
        || (!catchAll && !format && !dispatch.path.includes('[action]'))) {
      fail('invalid_dispatch_contract', target, 'Despacho exige handler existente, método e destinos explícitos únicos.');
      continue;
    }
    dispatchKeys.add(target);
    for (const value of values) {
      const property = catchAll ? 'resource' : format ? 'format' : 'action';
        if (!actions.some(action => action.ui?.bff?.path === dispatch.path
          && action.ui.bff.method === dispatch.method && action.ui.bff[property] === value)) {
        fail('dispatch_without_action_contract', target, `Destino dinâmico sem ficha canônica: ${value}`);
      }
    }
  }
  for (const auth of catalogue.authActions) {
    if (!methods.has(auth?.method) || !text(auth?.path) || !auth.path.startsWith('/api/auth/') || !bff.has(key(auth))
        || !text(auth.action) || !text(auth.recovery)) fail('invalid_auth_contract', auth?.path, 'Contrato de autenticação incompleto ou handler ausente.');
    else coveredBff.add(key(auth));
  }
  // Protocol endpoints have no commercial transition. They still require an
  // explicit per-method inventory and authentication/recovery contract.
  for (const protocol of catalogue.protocolActions ?? (api.has('POST /mcp') ? mcpProtocolActions : [])) {
    const target = text(protocol?.path) && methods.has(protocol?.method) ? key(protocol) : '';
    const inventorySet = protocol?.layer === 'api' ? api : protocol?.layer === 'bff' ? bff : null;
    const coverage = protocol?.layer === 'api' ? covered : coveredBff;
    if (!inventorySet || !methods.has(protocol?.method) || !text(protocol?.path)
        || !(/^\/mcp(?:\/|$)/.test(protocol.path) || protocol.path.startsWith('/.well-known/'))
        || !inventorySet.has(target) || coverage.has(target) || !text(protocol.action)
        || !text(protocol.authorization) || !text(protocol.recovery) || !texts(protocol.sources) || !protocol.sources.length) {
      fail('invalid_protocol_contract', protocol?.path, 'Protocolo exige operação existente, camada, autorização, recuperação e fontes explícitas.');
    } else coverage.add(target);
  }
  for (const target of api) if (!covered.has(target)) fail('api_without_action_contract', target, 'Operação descoberta sem ficha de ação.');
  for (const asset of catalogue.assetActions || []) {
    if (asset?.method !== 'GET' || !asset?.path?.startsWith('/assets/') || !bff.has(key(asset))
        || !text(asset.source) || asset.authentication !== 'public_static_asset' || !text(asset.action)) {
      fail('invalid_asset_contract', asset?.path, 'Ativo público precisa de rota GET, origem fixa e contrato explícito.');
    } else coveredBff.add(key(asset));
  }
  for (const target of bff) if (!coveredBff.has(target)) fail('bff_without_action_contract', target, 'Handler descoberto sem ação ou contrato de autenticação associado.');
  const pendingIds = new Set();
  for (const pending of catalogue.pendingFlows) {
    if (!text(pending?.id) || pendingIds.has(pending.id) || pending.status !== 'needs_definition'
        || !text(pending.title) || !text(pending.intent) || !texts(pending.openDecisions) || !pending.openDecisions.length
        || !texts(pending.requiredFields) || !pending.requiredFields.length) {
      fail('invalid_pending_contract', pending?.id, 'Pendência deve manter decisões e critérios ausentes explícitos, sem fingir implementação.');
    }
    pendingIds.add(pending?.id);
  }
  for (const finding of validateProductFlows(catalogue)) fail(finding.code, finding.path, finding.detail);
  return {
    status: findings.length ? 'invalid' : 'catalogued', runtimeVerdict: 'not_verified_by_catalog',
    apiOperations: api.size, cataloguedOperations: actions.length, bffOperations: bff.size,
    pendingFlows: catalogue.pendingFlows.length, p0Ready: !findings.length && !catalogue.pendingFlows.length,
    findings, catalogue,
  };
}
