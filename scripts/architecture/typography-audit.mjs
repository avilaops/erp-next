import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = path.join(root, "apps/web");
const require = createRequire(path.join(web, "package.json"));
const { chromium } = require("@playwright/test");
process.loadEnvFile(path.join(web, ".env.local"));
const origin = process.env.ERP_WEB_ORIGIN || "http://localhost:3002";
const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const output = path.join(root, "artifacts/typography-audit");
await mkdir(path.join(output, "screenshots"), { recursive: true });
const contractFile = [process.env.ERP_TYPOGRAPHY_OPENAPI, path.join(root, "artifacts/contracts/candidate.json"), path.resolve(root, "../erp-next/artifacts/contracts/candidate.json")].find(file => file && existsSync(file));
const contract = contractFile ? JSON.parse(await readFile(contractFile, "utf8")) : { paths: {} };

async function pages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? pages(path.join(directory, entry.name)) : entry.name === "page.tsx" ? [path.join(directory, entry.name)] : []))).flat();
}
const sourcePages = await pages(path.join(web, "src/app"));
const inventory = sourcePages.map(file => ({ source: path.relative(root, file).replaceAll("\\", "/"), route: "/" + path.relative(path.join(web, "src/app"), path.dirname(file)).replaceAll("\\", "/") }));
const expansions = {
  "[kind]": ["vendas", "margem-pedidos", "produtos", "clientes", "curva-abc", "metas"],
  "[section]": ["socio", "horarios", "pagamento", "extrato", "armazenamento", "importacoes", "plano", "cancelamento"],
  "[provider]": ["lojas"],
};
let routes = inventory.flatMap(item => {
  if (item.route === "/entrar") return [];
  let destinations = [item.route];
  for (const [parameter, values] of Object.entries(expansions)) destinations = destinations.flatMap(route => route.includes(parameter) ? values.map(value => route.replace(parameter, value)) : [route]);
  return destinations.map(route => ({ ...item, url: route.replaceAll("[id]", id), requiresRecord: route.includes("[id]") }));
});
routes = [...new Map(routes.map(route => [route.url, route])).values()].sort((a, b) => a.url.localeCompare(b.url));
const totalRoutes = routes.length;
let previousResults = [];
if (process.env.ERP_TYPOGRAPHY_RETRY === "1") {
  const previous = JSON.parse(await readFile(path.join(output, "audit.json"), "utf8"));
  const retryUrls = new Set(previous.results.filter(row => row.error || row.errors?.length || row.captures.length !== 2).map(row => row.url));
  previousResults = previous.results.filter(row => !retryUrls.has(row.url));
  routes = routes.filter(route => retryUrls.has(route.url));
}
if (process.env.ERP_TYPOGRAPHY_FILTER) routes = routes.filter(route => route.url.includes(process.env.ERP_TYPOGRAPHY_FILTER));

function sample(schema, key = "", depth = 0) {
  if (!schema || depth > 12) return null;
  if (schema.$ref) return sample(schema.$ref.split("/").slice(1).reduce((value, part) => value?.[part], contract), key, depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(value => sample(value, key, depth + 1)));
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf || schema.anyOf).find(value => value.type !== "null") || {}, key, depth + 1);
  if (schema.enum) return schema.enum.includes("active") ? "active" : schema.enum[0];
  if (schema.type === "object" || schema.properties) return Object.fromEntries(Object.entries(schema.properties || {}).map(([name, value]) => [name, sample(value, name, depth + 1)]));
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return /^can|^isEmployee|^isCustomer|^certificateReady|^collectionEnabled/.test(key);
  if (schema.type === "integer" || schema.type === "number") return /revision/i.test(key) ? 1 : 0;
  if (schema.type === "null") return null;
  if (key === "tenantId") return tenant;
  if (schema.format === "uuid" || /Id$/.test(key) || key === "id") return id;
  if (schema.format === "date-time" || /At$/.test(key)) return "2026-11-08T12:00:00Z";
  if (schema.format === "date" || /Date$/.test(key)) return "2026-11-08";
  if (/price|amount|quantity|balance|rate|cost/i.test(key)) return "0.00";
  if (/nsu/i.test(key)) return "000000000000000";
  if (key === "taxId" || key === "document") return "04252011000110";
  if (/name|title|label/i.test(key)) return "Registro de auditoria";
  if (/url|uri/i.test(key)) return "";
  return "";
}
const endpoints = Object.entries(contract.paths).filter(([, value]) => value.get).sort(([a], [b]) => (a.match(/\{/g)?.length || 0) - (b.match(/\{/g)?.length || 0)).map(([route, value]) => ({ pattern: new RegExp("^" + route.split("/").map(part => part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/") + "$"), get: value.get }));
function cookie() {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.ERP_SESSION_SECRET).digest(), iv);
  cipher.setAAD(Buffer.from("erp-session"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "isolated-typography-fixture", tenantId: tenant, expiresAt: Date.now() + 4 * 3600_000 })), cipher.final()]);
  return { name: "erp_session", value: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), url: origin, httpOnly: true, sameSite: "Lax" };
}
const browser = await chromium.launch();
const results = [...previousResults];
let cursor = 0;
async function save() {
  await writeFile(path.join(output, "audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scope: "Internal application typography; isolated schema-based fixtures, no production writes", templates: inventory.length, publicExcluded: ["/entrar"], planned: totalRoutes, results }, null, 2));
}
async function worker() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addCookies([cookie()]);
  const unmatched = new Set();
  await context.route("**/api/**", async route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { title: "Gravação desativada na auditoria" } });
    const pathname = new URL(request.url()).pathname.replace(/^\/api\/erp\//, "/api/v1/");
    if (pathname === "/api/v1/me") return route.fulfill({ json: { tenant: { id: tenant, legalName: "Empresa de auditoria" }, permissions: [], platformAdministrator: true } });
    const endpoint = endpoints.find(endpoint => endpoint.pattern.test(pathname));
    const schema = endpoint?.get.responses?.["200"]?.content?.["application/json"]?.schema;
    if (!schema) { unmatched.add(pathname); return route.fulfill({ status: 503, json: { title: "Fixture indisponível para esta operação" } }); }
    return route.fulfill({ headers: { ETag: '"1"' }, json: sample(schema) });
  });
  const page = await context.newPage();
  let errors = [];
  page.on("pageerror", error => errors.push(error.message));
  while (cursor < routes.length) {
    const route = routes[cursor++];
    errors = []; unmatched.clear();
    const result = { ...route, captures: [], errors: [], unmatchedApi: [] };
    try {
      const response = await page.goto(origin + route.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      result.http = response?.status();
      if (route.url.startsWith("/cadastros/vendedores")) await page.waitForURL(url => url.pathname.startsWith("/cadastros/funcionarios"), { timeout: 15000 });
      if (route.url === "/dashboard") await page.waitForURL(url => url.pathname === "/", { timeout: 15000 });
      result.finalUrl = new URL(page.url()).pathname;
      await page.locator("#conteudo-principal").waitFor({ timeout: 12000 });
      await page.waitForTimeout(200);
      for (const [width, height] of [[1440, 950], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const counts = {}, families = {}, weights = {}, violations = [];
          for (const element of document.querySelectorAll(".erp-workspace *, [data-slot=dialog-content] *")) {
            if (element.closest("svg, canvas, script, style, option") || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
            const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim();
            if (!text && !element.matches("input,select,textarea")) continue;
            const style = getComputedStyle(element), size = Number.parseFloat(style.fontSize);
            counts[size] = (counts[size] || 0) + 1;
            families[style.fontFamily] = (families[style.fontFamily] || 0) + 1;
            weights[style.fontWeight] = (weights[style.fontWeight] || 0) + 1;
            if (![12, 14, 18].includes(size)) violations.push({ tag: element.tagName, className: element.className, size, text: text.slice(0, 100) });
          }
          return { counts, families, weights, violations, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, heading: document.querySelector("main h1")?.textContent || null };
        });
        const filename = `${route.url.replace(/[^a-z0-9-]/gi, "_") || "home"}-${width}.png`;
        await page.screenshot({ path: path.join(output, "screenshots", filename), fullPage: true, animations: "disabled" });
        result.captures.push({ width, ...metrics, screenshot: `screenshots/${filename}` });
      }
    } catch (error) { result.error = error.message; }
    result.errors = errors.slice(0, 6); result.unmatchedApi = [...unmatched];
    results.push(result);
    if (results.length % 10 === 0) { await save(); console.log(JSON.stringify({ completed: results.length, planned: routes.length, deviations: results.filter(row => row.captures.some(capture => capture.violations.length)).length, blocked: results.filter(row => row.error).length })); }
  }
  await context.close();
}
const workers = Math.max(1, Math.min(3, Number(process.env.ERP_TYPOGRAPHY_WORKERS || 1)));
try { await Promise.all(Array.from({ length: workers }, () => worker())); } finally { await save(); await browser.close(); }
console.log(JSON.stringify({ completed: results.length, planned: totalRoutes, deviations: results.filter(row => row.captures.some(capture => capture.violations.length)).map(row => ({ route: row.url, violations: row.captures.flatMap(capture => capture.violations) })), blocked: results.filter(row => row.error).map(row => ({ route: row.url, error: row.error })), output }));
if (results.some(row => row.error || row.errors?.length || row.captures.length !== 2 || row.captures.some(capture => capture.violations.length))) process.exitCode = 1;
