import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover, analyze, normalizedRoute, routePattern, rustRoutes } from '../discovery.mjs';

const typescript = createRequire(new URL('../../apps/web/package.json', import.meta.url))('typescript');

test('Next route groups and dynamic parameter names normalize without changing ordinary paths', () => {
  assert.equal(routePattern('(private)/catalog/[id]'), '/catalog/[id]');
  assert.equal(routePattern(''), '/');
  assert.equal(normalizedRoute('/api/orders/[id]?limit=1'), normalizedRoute('/api/orders/{order_id}'));
  assert.notEqual(normalizedRoute('/api/orders'), normalizedRoute('/api/order'));
});

test('Rust scanner excludes comments, raw strings and cfg(test) servers and keeps method boundaries', () => {
  const source = `
    #[cfg(test)] mod tests_before;
    fn router() {
      // 📄 .route("/comment", get(fake))
      let text = r#".route("/raw", get(fake))"#;
      Router::new().route("/api/v1/items", get(list).post(create))
        .route("/api/v1/items/{id}/confirm", axum::routing::post(confirm))
    }
    #[cfg(test)] mod tests { fn fake() { Router::new().route("/userinfo", get(test_auth)); } }
    fn another() { Router::new().route("/health", get(health)); }
  `;
  const routes = rustRoutes(source, 'router.rs');
  assert.deepEqual(routes.map(item => [item.path, item.methods]), [
    ['/api/v1/items', ['GET', 'POST']], ['/api/v1/items/{id}/confirm', ['POST']], ['/health', ['GET']],
  ]);
  assert.ok(routes.every(item => item.line > 0));
});

test('real AST discovery links page to BFF and backend and marks inline no-ops without claiming execution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'erp-verification-unit-'));
  const files = {
    'apps/web/package.json': '{}',
    'apps/web/src/app/(private)/items/page.tsx': 'import { List } from "@/features/list"; export default function Page(){return <List/>}',
    'apps/web/src/features/list.tsx': `import "./cycle"; export function List(){fetch('/api/erp/items');fetch(dynamicUrl);return <button onClick={()=>{}}>Salvar</button>}`,
    'apps/web/src/features/cycle.ts': 'import "./list";',
    'apps/web/src/app/api/erp/items/route.ts': 'export const GET=(r:Request)=>forwardErp(r,"/items"); export const POST=(r:Request)=>forwardErp(r,"/items")',
    'apps/api/src/router.rs': 'fn routes(){Router::new().route("/api/v1/items",get(list).post(create))}',
    'apps/web/tests/items.spec.ts': 'test("items",async({page})=>{await page.goto("/items")})',
    'migrations/0001.sql': 'CREATE TABLE items(id uuid);',
  };
  try {
    for (const [file, source] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), source); }
    const inventory = await discover(root, { typescript });
    const findings = analyze(inventory);
    assert.equal(inventory.pages.length, 1); assert.equal(inventory.bff.length, 1); assert.equal(inventory.api.length, 1);
    const page = inventory.pages[0];
    assert.equal(page.path, '/items'); assert.equal(page.runtimeVerdict, 'not_verified_per_route');
    assert.equal(page.dependencies.length, 3); assert.equal(page.emptyActions.length, 1);
    assert.equal(page.unresolvedFetches.length, 1);
    assert.deepEqual(page.staticLinks[0].backend, ['/api/v1/items', '/api/v1/items']);
    assert.ok(findings.some(item => item.code === 'empty_ui_action'));
    assert.ok(!findings.some(item => item.severity === 'error'));
    assert.equal(inventory.browserTests[0].runtimeVerdict, 'not_associated_per_file');
    assert.equal(inventory.sourceHash.length, 64);
    const originalHash = inventory.sourceHash;
    await writeFile(path.join(root, 'migrations/0001.sql'), 'CREATE TABLE items(id uuid PRIMARY KEY);');
    assert.notEqual((await discover(root, { typescript })).sourceHash, originalHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing BFF targets, unsupported backend methods and duplicate page definitions have evidence', () => {
  const inventory = {
    pages: [{ path: '/items', file: 'page-a', apiReferences: [], emptyActions: [] }, { path: '/items', file: 'page-b', apiReferences: [], emptyActions: [] }],
    bff: [{ path: '/api/erp/items', methods: ['GET', 'POST'], forwards: [{ path: '/api/v1/items' }], file: 'handler-a' }, { path: '/api/erp/missing', methods: ['GET'], forwards: [{ path: '/api/v1/missing' }], file: 'handler-b' }],
    api: [{ path: '/api/v1/items', methods: ['GET'], file: 'router' }],
  };
  const findings = analyze(inventory);
  assert.deepEqual(findings.map(item => item.code).sort(), ['bff_method_missing', 'bff_target_missing', 'duplicate_route']);
  assert.ok(findings.every(item => item.evidence.length));
});

test('dynamic action dispatch is inconclusive rather than a false missing-backend error', () => {
  const inventory = {
    pages: [{ path: '/orders', file: 'page', apiReferences: [{ path: '/api/erp/orders/{param}/confirm', file: 'component', line: 1, methods: ['POST'] }], emptyActions: [] }],
    bff: [{ path: '/api/erp/orders/[id]/[action]', methods: ['POST'], forwards: [{ path: '/api/v1/orders/{param}/{param}' }], file: 'handler' }],
    api: [{ path: '/api/v1/orders/{id}/confirm', methods: ['POST'], file: 'router' }, { path: '/api/v1/orders/{id}/cancel', methods: ['POST'], file: 'router' }],
  };
  const findings = analyze(inventory);
  assert.deepEqual(findings.map(item => item.code), ['dynamic_forward_requires_runtime']);
  assert.equal(findings[0].severity, 'info');
  assert.equal(inventory.pages[0].staticLinks[0].bff, '/api/erp/orders/[id]/[action]');
});
