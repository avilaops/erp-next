import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This harness owns only a newly created database on a loopback test server.
const root = fileURLToPath(new URL("../", import.meta.url));
assert(existsSync(path.join(root, "apps/web", process.env.ERP_NEXT_DIST_DIR || ".next", "BUILD_ID")), "Build the selected Next.js output before starting the integration harness");
const source = new URL(process.env.COMPANY_TEST_DATABASE_URL || "postgres://erp_test@127.0.0.1:55439/postgres");
assert(["127.0.0.1", "localhost", "[::1]"].includes(source.hostname), "Use an isolated local PostgreSQL test server");
const pgBin = process.env.PG_BINDIR || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "/usr/bin");
const suffix = randomBytes(6).toString("hex");
const database = `erp_company_test_${suffix}`;
const role = `erp_company_role_${suffix}`;
const rolePassword = randomBytes(24).toString("hex");
const testUrl = new URL(source); testUrl.pathname = `/${database}`;
const tenant = "11111111-1111-4111-8111-111111111111";
function testOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "Use an explicit loopback HTTP test origin");
  return url.origin;
}
const origin = testOrigin(process.env.ERP_TEST_WEB_ORIGIN || "http://127.0.0.1:3202");
const issuer = testOrigin(process.env.ERP_TEST_AUTH_ORIGIN || "http://127.0.0.1:18441");
const apiOrigin = testOrigin(process.env.ERP_TEST_API_ORIGIN || "http://127.0.0.1:18081");
const env = { ...process.env, ERP_TEST_WEB_ORIGIN: origin, ERP_API_URL: apiOrigin, API_BIND_ADDRESS: new URL(apiOrigin).host, ERP_WEB_ORIGIN: origin, AUTH_ISSUER: issuer, AUTH_USERINFO_URL: `${issuer}/userinfo`, ERP_AUTH_CLIENT_ID: "fixture-client", ERP_AUTH_CLIENT_SECRET: randomBytes(24).toString("hex"), ERP_SESSION_SECRET: randomBytes(32).toString("hex"), ERP_DEFAULT_TENANT_ID: tenant };
const children = new Set();
let created = false;
let createdRole = false;
let certificateDirectory;

function sql(url, command) {
  const connection = new URL(url);
  const password = decodeURIComponent(connection.password); connection.password = "";
  const result = spawnSync(path.join(pgBin, process.platform === "win32" ? "psql.exe" : "psql"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", connection.toString()], { input: command, encoding: "utf8", windowsHide: true, env: { ...process.env, PGPASSWORD: password } });
  if (result.status !== 0) throw new Error(`Test database operation failed: ${result.stderr}`);
}

function launch(command, args, extra = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (error) => { console.error(error.message); });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => { if (chunk.toString().includes("Error:")) process.stderr.write(chunk); });
  children.add(child);
  return child;
}

async function stop(child) {
  if (child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
  }
  children.delete(child);
}

async function ready(url, child) {
  for (let index = 0; index < 150; index++) {
    if (child.exitCode !== null) throw new Error(`Service exited before readiness: ${child.exitCode}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* Wait for the process we own. */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Readiness timeout: ${url}`);
}

const codes = new Map();
const auth = createServer(async (request, response) => {
  const url = new URL(request.url, issuer);
  if (url.pathname === "/.well-known/openid-configuration") {
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, code_challenge_methods_supported: ["S256"] }));
  }
  if (url.pathname === "/authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    if (redirect.href !== `${origin}/api/auth/callback` || url.searchParams.get("code_challenge_method") !== "S256") { response.writeHead(400); return response.end(); }
    const code = randomBytes(20).toString("hex");
    codes.set(code, url.searchParams.get("code_challenge"));
    redirect.search = new URLSearchParams({ code, state: url.searchParams.get("state") }).toString();
    response.writeHead(302, { Location: redirect.href }); return response.end();
  }
  if (url.pathname === "/token") {
    let body = ""; for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    const challenge = codes.get(form.get("code")); codes.delete(form.get("code"));
    const expected = `Basic ${Buffer.from(`${env.ERP_AUTH_CLIENT_ID}:${env.ERP_AUTH_CLIENT_SECRET}`).toString("base64")}`;
    if (!challenge || challenge !== createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") || request.headers.authorization !== expected) { response.writeHead(401); return response.end(); }
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({ access_token: "fixture-editor-token", token_type: "Bearer", expires_in: 3600 }));
  }
  if (url.pathname === "/userinfo") {
    const subject = { "Bearer fixture-editor-token": "editor", "Bearer fixture-reader-token": "reader" }[request.headers.authorization];
    if (!subject) { response.writeHead(401); return response.end(); }
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify({ sub: subject, name: subject, email: `${subject}@example.test` }));
  }
  response.writeHead(404); response.end();
});

try {
  certificateDirectory = await mkdtemp(path.join(tmpdir(), "erp-a1-test-"));
  const certificateFixture = JSON.parse(await readFile(path.join(root, "apps/api/tests/fixtures/a1-synthetic.json"), "utf8"));
  env.FISCAL_A1_CA_BUNDLE_FILE = path.join(certificateDirectory, "test-root.pem");
  env.FISCAL_A1_KEYRING = JSON.stringify({ active: "isolated-test", keys: { "isolated-test": randomBytes(32).toString("base64") } });
  await writeFile(env.FISCAL_A1_CA_BUNDLE_FILE, certificateFixture.rootPem, { mode: 0o600 });
  await new Promise((resolve, reject) => { auth.once("error", reject); auth.listen(Number(new URL(issuer).port || 80), "127.0.0.1", resolve); });
  sql(source, `CREATE DATABASE ${database};`); created = true;
  const binary = process.env.ERP_TEST_API_BINARY || path.join(root, "target/company-verification/debug", process.platform === "win32" ? "erp-next-api.exe" : "erp-next-api");
  const migrator = launch(binary, ["migrate"], { DATABASE_URL: testUrl.toString() });
  const migrationCode = await new Promise((resolve) => migrator.once("exit", resolve));
  assert.equal(migrationCode, 0, "Isolated database migration failed");
  await stop(migrator);
  sql(testUrl, `
    INSERT INTO tenants (id, legal_name, tax_id) VALUES ('${tenant}', 'Empresa de teste', '04252011000110');
    INSERT INTO identities (id, auth_subject, email, display_name) VALUES
      ('33333333-3333-4333-8333-333333333333','editor','editor@example.test','Editor'),
      ('44444444-4444-4444-8444-444444444444','reader','reader@example.test','Leitor');
    INSERT INTO tenant_memberships (id, tenant_id, identity_id) VALUES
      ('66666666-6666-4666-8666-666666666666','${tenant}','33333333-3333-4333-8333-333333333333'),
      ('77777777-7777-4777-8777-777777777777','${tenant}','44444444-4444-4444-8444-444444444444');
    INSERT INTO roles (id, tenant_id, code, name) VALUES
      ('99999999-9999-4999-8999-999999999999','${tenant}','editor','Editor'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${tenant}','reader','Leitor');
    INSERT INTO role_permissions (role_id, permission_code) VALUES
      ('99999999-9999-4999-8999-999999999999','platform.company.read'),
      ('99999999-9999-4999-8999-999999999999','platform.company.manage'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.company.read');
    INSERT INTO role_permissions (role_id, permission_code)
      SELECT '99999999-9999-4999-8999-999999999999', code FROM permissions ON CONFLICT DO NOTHING;
    INSERT INTO role_permissions (role_id, permission_code) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.users.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.roles.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.products.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','inventory.stock.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.parties.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.receivables.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.categories.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.categories.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.accounts.read'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.payment_methods.read');
    INSERT INTO membership_roles (membership_id, role_id) VALUES
      ('66666666-6666-4666-8666-666666666666','99999999-9999-4999-8999-999999999999'),
      ('77777777-7777-4777-8777-777777777777','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  `);
  sql(source, `CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${rolePassword}';`); createdRole = true;
  sql(testUrl, `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};`);
  const applicationUrl = new URL(testUrl); applicationUrl.username = role; applicationUrl.password = rolePassword;
  const api = launch(binary, [], { DATABASE_URL: applicationUrl.toString() });
  await ready(`${env.ERP_API_URL}/health/ready`, api);
  const seed = await fetch(`${env.ERP_API_URL}/api/v1/company`, { method: "PUT", headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant, "If-Match": '"0"', "Content-Type": "application/json" }, body: JSON.stringify({ legalName: "Empresa de teste", personType: "juridica", taxId: "04252011000110", taxRegime: "simples", segments: ["Indústria"], postalCode: "01001000", state: "SP", city: "São Paulo", street: "Rua de Teste", number: "1", district: "Centro" }) });
  assert.equal(seed.status, 200, await seed.text());
  const contract = await (await fetch(`${env.ERP_API_URL}/openapi.json`)).json();
  assert(contract.paths["/api/v1/company"].put);
  assert(contract.paths["/api/v1/parties"].post);
  assert(contract.paths["/api/v1/parties/{id}"].put);
  assert(contract.paths["/api/v1/orders/{id}/complete"].post);
  assert(contract.paths["/api/v1/orders/{id}"].put);
  for (const resource of ["product-categories", "financial-categories", "financial-accounts", "payment-methods"]) {
    assert(contract.paths[`/api/v1/${resource}`].post);
    assert(contract.paths[`/api/v1/${resource}/{id}`].put);
  }
  assert(contract.paths["/api/v1/receivables/{id}/payments"].post);
  const web = launch(process.execPath, [path.join(root, "apps/web/node_modules/next/dist/bin/next"), "start", path.join(root, "apps/web"), "--port", new URL(origin).port || "80", "--hostname", "127.0.0.1"], {});
  await ready(`${origin}/entrar`, web);
  const browserArguments = [path.join(root, "apps/web/node_modules/@playwright/test/cli.js"), "test", "--config", process.env.ERP_TEST_BROWSER_CONFIG || "playwright.company.config.ts"];
  if (process.env.ERP_TEST_BROWSER_GREP) browserArguments.push("--grep", process.env.ERP_TEST_BROWSER_GREP);
  const playwright = spawn(process.execPath, browserArguments, { cwd: path.join(root, "apps/web"), env, windowsHide: true, stdio: "inherit" });
  const code = await new Promise((resolve) => playwright.once("exit", resolve));
  if (code !== 0) throw new Error(`ERP browser checks failed: ${code}`);
  const readCompany = async () => {
    const response = await fetch(`${env.ERP_API_URL}/api/v1/company`, { headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const beforeRestart = await readCompany();
  const readAccess = async () => {
    const resources = ["roles", "users/77777777-7777-4777-8777-777777777777"];
    return Promise.all(resources.map(async resource => {
      const response = await fetch(`${env.ERP_API_URL}/api/v1/${resource}`, { headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant } });
      assert.equal(response.status, 200);
      return response.json();
    }));
  };
  const accessBeforeRestart = await readAccess();
  const readInventory = async () => {
    const headers = { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant };
    const balances = await fetch(`${env.ERP_API_URL}/api/v1/stock?limit=100`, { headers });
    assert.equal(balances.status, 200);
    const stock = await balances.json();
    assert(stock.total <= 100, "Persistence fixture must fit its explicit page");
    const movements = await Promise.all(stock.data.map(async product => {
      const response = await fetch(`${env.ERP_API_URL}/api/v1/stock/movements?productId=${product.productId}&limit=100`, { headers });
      assert.equal(response.status, 200);
      const history = await response.json();
      assert(history.total <= 100, "Persistence history must fit its explicit page");
      return history;
    }));
    return { stock, movements };
  };
  const inventoryBeforeRestart = await readInventory();
  const readParties = async () => {
    const headers = { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant };
    const response = await fetch(`${env.ERP_API_URL}/api/v1/parties?limit=100`, { headers });
    assert.equal(response.status, 200);
    const parties = await response.json();
    assert(parties.total <= 100, "Party fixture must fit its explicit page");
    const records = await Promise.all(parties.data.map(async party => {
      const detail = await fetch(`${env.ERP_API_URL}/api/v1/parties/${party.id}`, { headers });
      assert.equal(detail.status, 200);
      return { etag: detail.headers.get("etag"), body: await detail.json() };
    }));
    return { parties, records };
  };
  const partiesBeforeRestart = await readParties();
  const readOperations = async () => {
    const headers = { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant };
    return Promise.all(["orders", "receivables"].map(async endpoint => {
      const response = await fetch(`${env.ERP_API_URL}/api/v1/${endpoint}?limit=100`, { headers });
      assert.equal(response.status, 200);
      const list = await response.json();
      assert(list.total <= 100, "Operation fixture must fit its explicit page");
      const details = await Promise.all(list.data.map(async record => {
        const detail = await fetch(`${env.ERP_API_URL}/api/v1/${endpoint}/${record.id}`, { headers });
        assert.equal(detail.status, 200);
        return { etag: detail.headers.get("etag"), body: await detail.json() };
      }));
      return { list, details };
    }));
  };
  const operationsBeforeRestart = await readOperations();
  const readReferences = async () => Promise.all(["product-categories", "financial-categories", "financial-accounts", "payment-methods"].map(async resource => {
    const response = await fetch(`${env.ERP_API_URL}/api/v1/${resource}?limit=100`, { headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant } });
    assert.equal(response.status, 200);
    const list = await response.json();
    assert(list.total <= 100, "Reference fixture must fit its explicit page");
    const details = await Promise.all(list.data.map(async record => {
      const response = await fetch(`${env.ERP_API_URL}/api/v1/${resource}/${record.id}`, { headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant } });
      assert.equal(response.status, 200);
      return { etag: response.headers.get("etag"), body: await response.json() };
    }));
    return { resource, list, details };
  }));
  const referencesBeforeRestart = await readReferences();
  const readCertificate = async () => {
    const response = await fetch(`${env.ERP_API_URL}/api/v1/fiscal/certificate`, { headers: { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const certificateBeforeRestart = await readCertificate();
  const readNfeDrafts = async () => {
    const headers = { Authorization: "Bearer fixture-editor-token", "X-Tenant-Id": tenant };
    const response = await fetch(`${env.ERP_API_URL}/api/v1/fiscal/nfe?limit=100`, { headers });
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.nextCursor, null, "Fiscal persistence fixture must fit one page");
    const details = await Promise.all(page.data.map(async draft => {
      const response = await fetch(`${env.ERP_API_URL}/api/v1/fiscal/nfe/${draft.id}`, { headers });
      assert.equal(response.status, 200);
      return { etag: response.headers.get("etag"), data: await response.json() };
    }));
    return { page, details };
  };
  const nfeBeforeRestart = await readNfeDrafts();
  await stop(api);
  const restarted = launch(binary, [], { DATABASE_URL: applicationUrl.toString() });
  await ready(`${env.ERP_API_URL}/health/ready`, restarted);
  assert.deepEqual(await readCompany(), beforeRestart);
  assert.deepEqual(await readAccess(), accessBeforeRestart);
  assert.deepEqual(await readInventory(), inventoryBeforeRestart);
  assert.deepEqual(await readParties(), partiesBeforeRestart);
  assert.deepEqual(await readOperations(), operationsBeforeRestart);
  assert.deepEqual(await readReferences(), referencesBeforeRestart);
  assert.deepEqual(await readCertificate(), certificateBeforeRestart);
  assert.deepEqual(await readNfeDrafts(), nfeBeforeRestart);
  console.log("NF-e drafts, their issuer snapshots and revisions survived an API process restart.");
  console.log("Product categories, financial categories, financial accounts and payment methods survived an API process restart.");
  console.log("Company, roles, memberships, stock, parties, orders, receivables and payment histories survived an API process restart.");
  console.log("Verified: Rust API + non-superuser PostgreSQL + PKCE test provider + production Next.js + browser.");
} finally {
  for (const child of [...children]) await stop(child);
  await new Promise((resolve) => auth.close(resolve));
  if (created) sql(source, `DROP DATABASE ${database} WITH (FORCE);`);
  if (createdRole) sql(source, `DROP ROLE ${role};`);
  if (certificateDirectory) {
    const target = path.resolve(certificateDirectory);
    assert(path.dirname(target) === path.resolve(tmpdir()) && path.basename(target).startsWith("erp-a1-test-"), "Refuse to remove a directory outside the owned certificate test location");
    assert(!(await lstat(target)).isSymbolicLink(), "Refuse to remove a substituted certificate test directory");
    await rm(target, { recursive: true, force: true });
  }
}
