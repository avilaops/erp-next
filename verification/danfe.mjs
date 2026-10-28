import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const checks = Object.freeze([
  ['envelope', 'domains::fiscal::danfe::tests::envelope_consistency_does_not_claim_signature_or_sefaz_authenticity', 'Envelope e identidade do documento; sem atestar autenticidade'],
  ['protocol', 'domains::fiscal::danfe::tests::invalid_protocol_key_namespace_digest_and_non_nfe_documents_are_refused', 'Recusa de chave, modelo, protocolo, namespace e digest incompatíveis'],
  ['xml-safety', 'domains::fiscal::danfe::tests::duplicate_documents_dtd_and_size_overflow_are_refused', 'Recusa de duplicatas, DTD e tamanho excessivo'],
  ['mcp-transport', 'domains::fiscal::danfe_client::tests::json_sse_and_structured_results_validate_before_rendering_and_close_the_session', 'Transporte MCP JSON/SSE, ordem das validações e encerramento de sessão'],
  ['validation-gates', 'domains::fiscal::danfe_client::tests::schema_and_signature_refusals_never_reach_the_renderer', 'XSD/assinatura recusados impedem renderização'],
  ['provider-failures', 'domains::fiscal::danfe_client::tests::provider_errors_invalid_pdf_and_wrong_invoice_are_not_successful_downloads', 'Falhas do serviço, PDF inválido e chave diferente não aprovam o download'],
  ['configuration', 'domains::fiscal::danfe_client::tests::credentials_and_untrusted_redirect_targets_are_not_accepted_or_exposed', 'Configuração restrita e credenciais omitidas de diagnóstico'],
  ['authorization', 'http::danfe_tests::danfe_denies_missing_identity_inactive_membership_and_missing_fiscal_rights_before_mcp', 'HTTP real com identidade ausente/inválida, associação inativa e falta de permissão'],
  ['company', 'http::danfe_tests::danfe_checks_document_company_even_when_the_operator_has_access_to_both_tenants', 'XML de outra empresa recusado, inclusive para operador com acesso às duas'],
  ['binary-output', 'http::danfe_tests::danfe_returns_binary_pdf_with_hashes_without_creating_or_issuing_an_invoice', 'PDF binário e hashes preservados; sem criar rascunho ou emitir nota'],
  ['unavailable', 'http::danfe_tests::danfe_unconfigured_service_is_not_a_successful_pdf_response', 'Serviço não configurado retorna indisponibilidade'],
  ['signature-http', 'http::danfe_tests::danfe_signature_refusal_stops_before_pdf_generation', 'Recusa criptográfica não retorna um PDF HTTP'],
].map(([id, test, criterion]) => Object.freeze({ id, test, criterion })));

export const DANFE_PLAN = Object.freeze({
  id: 'fiscal-danfe', version: '1', title: 'DANFE de XML com protocolo',
  page: '/fiscal/danfe', bff: 'POST /api/erp/fiscal/danfe', api: 'POST /api/v1/fiscal/danfe',
  environment: 'local_isolated', authAdapter: 'synthetic', mcpAdapter: 'test_double',
  checks,
});
const files = [
  'Cargo.toml', 'Cargo.lock', 'apps/api/Cargo.toml', 'apps/api/src/main.rs', 'apps/api/src/domains/fiscal/danfe.rs',
  'apps/api/src/domains/fiscal/danfe_client.rs', 'apps/api/src/domains/fiscal/danfe_test_support.rs',
  'apps/api/src/http/danfe_tests.rs', 'apps/api/src/http/company_tests.rs',
  'apps/api/src/http/mod.rs', 'apps/api/src/http/openapi.rs', 'apps/api/src/domains/mod.rs',
  'apps/api/src/domains/fiscal/mod.rs', 'apps/api/src/platform/auth.rs',
  'apps/api/src/platform/access.rs', 'apps/api/src/platform/state.rs', 'apps/api/src/config.rs',
  'apps/api/tests/fixtures/nfe-protocol-synthetic.xml', 'apps/api/tests/fixtures/danfe-provider-synthetic.b64',
  'apps/web/src/lib/erp-danfe-proxy.ts', 'apps/web/src/features/fiscal/danfe-download.tsx',
  'apps/web/src/lib/erp-session.ts', 'apps/web/package.json', 'apps/web/next.config.ts',
  'apps/web/tests/danfe-ui.spec.ts', 'apps/web/playwright.danfe.config.ts',
  'apps/web/src/app/fiscal/danfe/page.tsx', 'apps/web/src/app/api/erp/fiscal/danfe/route.ts',
  'verification/danfe.mjs', 'verification/suites.mjs',
];
const hash = value => createHash('sha256').update(value).digest('hex');
export async function danfeSources(root) {
  const migrations = (await readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).map(file => `migrations/${file}`);
  const sources = await Promise.all([...files, ...migrations].sort().map(async file => ({ file, sha256: hash(await readFile(path.join(root, file))) })));
  return { files: sources, sha256: hash(JSON.stringify(sources)) };
}
export function assessDanfeSuite(result, before, after) {
  const observed = new Map();
  for (const line of result.log.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^test ([A-Za-z0-9_:]+) \.\.\. (ok|FAILED|ignored)$/);
    if (match) observed.set(match[1], [...(observed.get(match[1]) ?? []), match[2]]);
  }
  const items = checks.map(check => {
    const values = observed.get(check.test) ?? [];
    const status = values.length !== 1 ? 'not_run' : values[0] === 'ok' ? 'passed' : values[0] === 'FAILED' ? 'failed' : 'not_run';
    return { ...check, status, reason: values.length > 1 ? 'ambiguous_duplicate_result' : values.length ? 'observed_test_result' : 'test_not_observed' };
  });
  const sourceStable = before.sha256 === after.sha256;
  const verdict = items.some(item => item.status === 'failed') || result.verdict === 'failed' ? 'failed'
    : sourceStable && result.verdict === 'passed' && items.every(item => item.status === 'passed') ? 'passed' : 'inconclusive';
  return { ...DANFE_PLAN, checks: items, verdict, sourceStable, source: before, sourceHashAfter: after.sha256,
    logSha256: hash(result.log), planSha256: hash(JSON.stringify(DANFE_PLAN)),
    assurance: 'named_tests_in_isolated_environment',
    unverified: ['browser_flow', 'real_authorized_customer_xml', 'live_sefaz_status', 'production_auth_and_mcp', 'production_deployment'],
  };
}
