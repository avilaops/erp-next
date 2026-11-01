import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const root = fileURLToPath(new URL("../../", import.meta.url));
const web = "apps/web/src/";

export function routeSurface(paths) {
  const routes = paths.filter(name => name.startsWith(`${web}app/`) && /\/(page\.tsx|route\.ts|layout\.tsx)$/.test(name)).sort();
  return { count: routes.length, sha256: createHash("sha256").update(`${routes.join("\n")}\n`).digest("hex") };
}

function inspect(name, content) {
  const source = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true);
  const imports = [];
  let client = false;
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client") client = true;
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allTypes = bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
      if (!node.isTypeOnly && !clause?.isTypeOnly && !allTypes) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, client };
}

export function validateStructure(files, policy) {
  const errors = [];
  const nodes = new Map();
  for (const [name, content] of files) {
    for (const retired of policy.retiredPaths || []) {
      if (name === retired || (retired.endsWith("/") && name.startsWith(retired))) errors.push(`Local retirado de uso: ${name}`);
    }
    if (!name.startsWith(web)) continue;
    const relative = name.slice(web.length);
    if (relative.includes("/") && !policy.webLayers[relative.split("/")[0]]) errors.push(`Camada sem responsabilidade registrada: ${name}`);
    if (relative.startsWith("features/") && relative.split("/").length > 2 && !policy.featureDomains[relative.split("/")[1]]) errors.push(`Domínio sem responsabilidade registrada: ${name}`);
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".d.ts")) continue;
    const node = inspect(name, content);
    nodes.set(name, node);
    if (relative.startsWith("server/") && !node.imports.includes("server-only")) errors.push(`Módulo de servidor sem server-only: ${name}`);
  }
  const resolve = (name, specifier) => {
    const target = specifier.startsWith("@/") ? web + specifier.slice(2)
      : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)) : null;
    if (!target) return null;
    return [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(candidate => nodes.has(candidate)) || null;
  };
  const graph = new Map();
  for (const [name, node] of nodes) {
    const edges = node.imports.map(specifier => resolve(name, specifier)).filter(Boolean);
    graph.set(name, edges);
    for (const target of edges) {
      const relative = name.slice(web.length), dependency = target.slice(web.length);
      if (relative.startsWith("lib/") && !dependency.startsWith("lib/")) errors.push(`lib depende de uma camada superior: ${name} -> ${target}`);
      if (relative.startsWith("components/ui/") && /^(features|app|server)\//.test(dependency)) errors.push(`UI básica depende de domínio ou servidor: ${name} -> ${target}`);
      if (relative.startsWith("features/") && dependency.startsWith("app/")) errors.push(`Funcionalidade depende da rota: ${name} -> ${target}`);
      if (relative.startsWith("server/") && /^(features|components|hooks|app)\//.test(dependency)) errors.push(`Servidor depende da interface: ${name} -> ${target}`);
    }
  }
  for (const [entry, node] of nodes) {
    if (!node.client) continue;
    const visited = new Set();
    const visit = (name, chain) => {
      if (visited.has(name)) return;
      visited.add(name);
      const current = nodes.get(name);
      if (name.startsWith(`${web}server/`) || current.imports.some(item => item === "server-only" || item === "next/headers" || item.startsWith("node:"))) {
        errors.push(`Cliente alcança código de servidor: ${[...chain, name].join(" -> ")}`);
        return;
      }
      for (const target of graph.get(name)) visit(target, [...chain, name]);
    };
    visit(entry, []);
  }
  if (policy.routeSurface) {
    const surface = routeSurface([...files.keys()]);
    if (surface.count !== policy.routeSurface.count || surface.sha256 !== policy.routeSurface.sha256) errors.push("A superfície de rotas mudou. Revise URLs e atualize architecture/structure.json explicitamente.");
  }
  return errors;
}

async function main() {
  const names = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  if (process.argv.includes("--print-routes")) { console.log(JSON.stringify(routeSurface(names), null, 2)); return; }
  const policy = JSON.parse(await readFile(path.join(root, "architecture/structure.json"), "utf8"));
  const files = new Map(await Promise.all(names.filter(name => name.startsWith(web) || name.endsWith(".rs")).map(async name => [name, /\.(ts|tsx|rs)$/.test(name) ? await readFile(path.join(root, name), "utf8") : ""])));
  const errors = validateStructure(files, policy);
  console.log(JSON.stringify({ schemaVersion: "erp-structure-check/1", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), routeSurface: routeSurface(names), errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
