import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function requireContract(condition, detail) {
  if (!condition) throw new Error(`fiscal_contract:${detail}`);
}

/** Verify the declared surface consumed by the examples, not backend behavior. */
export function verifyFiscalContract(document) {
  requireContract(/^3\.[01]\./.test(document?.openapi ?? ''), 'invalid_openapi');
  const scheme = document.components?.securitySchemes?.bearerAuth;
  requireContract(scheme?.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer', 'bearer_scheme');
  const surface = [['readiness', 'get'], ['nfe/{id}', 'get'], ['nfe', 'post'],
    ['nfe/{id}/issue', 'post'], ['nfe/{id}/consult', 'post'], ['nfe/{id}/emission', 'get'], ['nfe/{id}/xml', 'get'], ['danfe', 'post']];
  const tenantHeaderNotDeclared = [];
  for (const [resource, method] of surface) {
    const path = `/api/v1/fiscal/${resource}`;
    const item = document.paths?.[path];
    const operation = item?.[method];
    requireContract(operation, `${method}:${path}`);
    const security = operation.security ?? document.security ?? [];
    requireContract(security.length > 0 && security.every(value => Object.hasOwn(value, 'bearerAuth')), `auth:${path}`);
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
    const requiredHeader = name => parameters.some(value => value.in === 'header' && value.name?.toLowerCase() === name.toLowerCase() && value.required === true);
    if (!requiredHeader('X-Tenant-Id')) tenantHeaderNotDeclared.push(`${method.toUpperCase()} ${path}`);
    if (method === 'post' && resource !== 'danfe') requireContract(requiredHeader('Idempotency-Key'), `idempotency:${path}`);
    const mutatingSnapshot = resource.endsWith('/issue') || resource.endsWith('/consult');
    if (mutatingSnapshot) {
      requireContract(requiredHeader('If-Match'), `revision:${path}`);
    }
    if (mutatingSnapshot || resource.endsWith('/emission')) {
      for (const status of mutatingSnapshot ? ['200', '202'] : ['200']) {
        let schema = operation.responses?.[status]?.content?.['application/json']?.schema;
        if (schema?.$ref) {
          requireContract(schema.$ref.startsWith('#/components/schemas/'), `external_schema:${path}`);
          schema = document.components?.schemas?.[schema.$ref.slice('#/components/schemas/'.length)];
        }
        requireContract(['tenantId', 'id', 'revision', 'status', 'environment'].every(field => schema?.required?.includes(field)), `snapshot_${status}:${path}`);
      }
    }
    if (!resource.endsWith('/xml') && resource !== 'danfe') {
      const status = resource === 'nfe' ? '201' : '200';
      requireContract(operation.responses?.[status]?.content?.['application/json']?.schema, `json_${status}:${path}`);
    }
    if (resource.endsWith('/xml')) requireContract(operation.responses?.['200']?.content?.['application/xml'], 'xml_media_type');
    if (resource === 'danfe') requireContract(operation.responses?.['200']?.content?.['application/pdf'], 'pdf_media_type');
  }
  return { operations: surface.length, tenantHeaderNotDeclared, runtimeVerified: false };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const bytes = await readFile(process.argv[2] ?? 'artifacts/contracts/candidate.json');
    requireContract(bytes.length <= 20 * 1024 * 1024, 'oversized_openapi');
    console.log(JSON.stringify({ ...verifyFiscalContract(JSON.parse(bytes)), sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
