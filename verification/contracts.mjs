import { normalizedRoute } from './discovery.mjs';

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
  const api = new Set(inventory.api.flatMap(route => route.methods.map(method => key({ method, path: route.path }))));
  const bff = new Set(inventory.bff.flatMap(route => route.methods.map(method => key({ method, path: route.path }))));
  const pages = new Set(inventory.pages.map(page => normalizedRoute(page.path)));
  const covered = new Set(), coveredBff = new Set(), ids = new Set();
  for (const action of catalogue.actions) {
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
    if (action.input?.body && (!text(action.input.body.source) || !text(action.input.body.type))) fail('invalid_body_reference', target, 'O corpo precisa referenciar o tipo e a fonte reais.');
    for (const page of action.ui?.pages || []) {
      if (!text(page) || !pages.has(normalizedRoute(page))) fail('contract_without_page', target, 'Página referenciada não encontrada.');
    }
    const proxy = action.ui?.bff;
    if (proxy) {
      if (!methods.has(proxy.method) || !text(proxy.path) || !bff.has(key(proxy))) {
        fail('contract_without_bff', target, 'Método/caminho BFF ausente.'); continue;
      }
      coveredBff.add(key(proxy));
      let expected = proxy.path.replace('/api/erp/', '/api/v1/').replace('[id]', '{id}');
      if (proxy.path.includes('[action]')) {
        const dispatch = catalogue.dispatches.find(item => item.path === proxy.path && item.method === proxy.method);
        if (!text(proxy.action) || !dispatch?.actions?.includes(proxy.action)) fail('undefined_dispatch_action', target, 'Ação dinâmica não especificada no catálogo.');
        expected = expected.replace('[action]', proxy.action || '');
      }
      if (operation.method !== proxy.method || normalizedRoute(expected) !== normalizedRoute(operation.path)) fail('wrong_bff_target', target, 'O BFF declarado não corresponde à operação desta ficha.');
    }
  }
  for (const auth of catalogue.authActions) {
    if (!methods.has(auth?.method) || !text(auth?.path) || !auth.path.startsWith('/api/auth/') || !bff.has(key(auth))
        || !text(auth.action) || !text(auth.recovery)) fail('invalid_auth_contract', auth?.path, 'Contrato de autenticação incompleto ou handler ausente.');
    else coveredBff.add(key(auth));
  }
  for (const target of api) if (!covered.has(target)) fail('api_without_action_contract', target, 'Operação descoberta sem ficha de ação.');
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
  return {
    status: findings.length ? 'invalid' : 'catalogued', runtimeVerdict: 'not_verified_by_catalog',
    apiOperations: api.size, cataloguedOperations: catalogue.actions.length, bffOperations: bff.size,
    pendingFlows: catalogue.pendingFlows.length, p0Ready: !findings.length && !catalogue.pendingFlows.length,
    findings, catalogue,
  };
}
