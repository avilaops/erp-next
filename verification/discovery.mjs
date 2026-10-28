import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const slash = value => value.split(path.sep).join('/');
const hash = value => createHash('sha256').update(value).digest('hex');
const verbs = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || ['node_modules', '.git', 'target'].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(file));
    else result.push(file);
  }
  return result.sort();
}

export function routePattern(relativeDirectory) {
  const parts = slash(relativeDirectory).split('/').filter(part => part && part !== '.' && !/^\([^)]*\)$/.test(part) && !part.startsWith('@'));
  return '/' + parts.join('/');
}

export function normalizedRoute(value) {
  return value.split('?')[0].replace(/\[([^\]]+)\]|\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/';
}

function compatibleRoutes(left, right) {
  const a = normalizedRoute(left).split('/'), b = normalizedRoute(right).split('/');
  return a.length === b.length && a.every((part, index) => part === b[index] || part === '{}' || b[index] === '{}');
}

function hasExport(ts, node) {
  return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function expressions(ts, node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text + node.templateSpans.map(span => '{param}' + span.literal.text).join('')];
  }
  if (ts.isConditionalExpression(node)) return [...expressions(ts, node.whenTrue), ...expressions(ts, node.whenFalse)];
  return [];
}

function requestMethods(ts, options) {
  if (!options) return ['GET'];
  if (!ts.isObjectLiteralExpression(options)) return ['UNKNOWN'];
  const method = options.properties.find(prop => prop.name?.getText() === 'method');
  if (!method) return options.properties.some(ts.isSpreadAssignment) ? ['UNKNOWN'] : ['GET'];
  return expressions(ts, method.initializer).map(value => value.toUpperCase()).filter(value => verbs.has(value)).concat(
    expressions(ts, method.initializer).length ? [] : ['UNKNOWN'],
  );
}

function inspectTypeScript(ts, source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = [], fetches = [], unresolvedFetches = [], forwards = [], emptyActions = [], methods = [];
  const line = node => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isFunctionDeclaration(node) && hasExport(ts, node) && verbs.has(node.name?.text)) methods.push(node.name.text);
    if (ts.isVariableStatement(node) && hasExport(ts, node)) {
      for (const declaration of node.declarationList.declarations) if (verbs.has(declaration.name.getText())) methods.push(declaration.name.getText());
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const item of node.exportClause.elements) if (verbs.has(item.name.text)) methods.push(item.name.text);
    }
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'fetch') {
      if (!expressions(ts, node.arguments[0]).length) unresolvedFetches.push({ line: line(node), reason: 'dynamic_target_requires_runtime_trace' });
      for (const target of expressions(ts, node.arguments[0])) {
        if (target.startsWith('/api/')) fetches.push({ path: target.split('?')[0], methods: requestMethods(ts, node.arguments[1]), line: line(node) });
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'forwardErp') {
      for (const target of expressions(ts, node.arguments[1])) if (target.startsWith('/')) forwards.push({ path: '/api/v1' + target, line: line(node) });
    }
    if (ts.isJsxAttribute(node) && ['onClick', 'onSubmit'].includes(node.name.getText()) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const action = node.initializer.expression;
      if (action && ts.isArrowFunction(action) && ts.isBlock(action.body) && action.body.statements.length === 0) emptyActions.push({ event: node.name.getText(), line: line(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { imports, fetches, unresolvedFetches, forwards, emptyActions, methods: [...new Set(methods)].sort() };
}

// Preserve offsets while masking Rust comments and string/character literals.
function rustMask(source) {
  const chars = source.split('');
  const blank = (start, end) => { for (let n = start; n < end; n++) if (chars[n] !== '\n') chars[n] = ' '; };
  for (let i = 0; i < source.length;) {
    const start = i;
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i); if (i < 0) i = source.length; blank(start, i);
    } else if (source.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; } else i++;
      }
      blank(start, i);
    } else {
      const raw = source.slice(i).match(/^r(#{0,20})"/);
      if (raw) {
        const endToken = '"' + raw[1];
        const end = source.indexOf(endToken, i + raw[0].length);
        i = end < 0 ? source.length : end + endToken.length; blank(start, i);
      } else if (source[i] === '"' || (source[i] === "'" && /^'(?:[^'\\\n]|\\.)'/.test(source.slice(i)))) {
        const quote = source[i++];
        while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === quote) break; }
        blank(start, i);
      } else i++;
    }
  }
  return chars.join('');
}

function productionRustMask(source) {
  let mask = rustMask(source);
  // Test modules may contain fake Auth servers; they are not application routes.
  for (const match of mask.matchAll(/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/g)) {
    const brace = mask.indexOf('{', match.index + match[0].length);
    const semicolon = mask.indexOf(';', match.index + match[0].length);
    let end;
    if (semicolon >= 0 && (brace < 0 || semicolon < brace)) end = semicolon + 1;
    else {
      let depth = 1; end = brace + 1;
      while (end < mask.length && depth) { if (mask[end] === '{') depth++; if (mask[end] === '}') depth--; end++; }
    }
    mask = mask.slice(0, match.index) + mask.slice(match.index, end).replace(/[^\n]/g, ' ') + mask.slice(end);
  }
  return mask;
}

export function rustRoutes(source, file) {
  const mask = productionRustMask(source);
  const result = [];
  for (const match of mask.matchAll(/\.route\s*\(/g)) {
    let depth = 1, end = match.index + match[0].length;
    const start = end;
    while (end < mask.length && depth) { if (mask[end] === '(') depth++; if (mask[end] === ')') depth--; end++; }
    const call = source.slice(start, end - 1);
    const url = call.match(/^\s*"([^"\\]+)"\s*,/);
    if (!url) continue;
    const methods = [...new Set([...call.slice(url[0].length).matchAll(/\b(get|post|put|patch|delete|head|options)\s*\(/g)].map(item => item[1].toUpperCase()))].sort();
    result.push({ path: url[1], methods, file, line: source.slice(0, match.index).split('\n').length });
  }
  return result;
}

// Follow the ordinary Rust module tree; a file's name does not determine whether
// it belongs to tests. Keep all files in sourceFiles for provenance below.
function productionRustFiles(sources, directory) {
  const entries = ['main.rs', 'lib.rs'].map(file => path.join(directory, file)).filter(file => sources.has(file));
  if (!entries.length) return new Set([...sources.keys()].filter(file => !/(?:^|_)tests\.rs$/.test(file)));
  const visited = new Set();
  function follow(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const base = ['main.rs', 'lib.rs', 'mod.rs'].includes(path.basename(file))
      ? path.dirname(file) : path.join(path.dirname(file), path.basename(file, '.rs'));
    for (const declaration of productionRustMask(sources.get(file)).matchAll(/\bmod\s+([A-Za-z_][A-Za-z_0-9]*)\s*;/g)) {
      const name = declaration[1];
      const next = [path.join(base, `${name}.rs`), path.join(base, name, 'mod.rs')].find(candidate => sources.has(candidate));
      if (next) follow(next);
    }
  }
  for (const entry of entries) follow(entry);
  return visited;
}

export async function discover(root, options = {}) {
  const webRoot = path.join(root, 'apps/web');
  const srcRoot = path.join(webRoot, 'src');
  const appRoot = path.join(srcRoot, 'app');
  const ts = options.typescript || createRequire(path.join(webRoot, 'package.json'))('typescript');
  const sources = new Map();
  for (const absolute of await walk(srcRoot)) {
    if (!/\.(?:ts|tsx|js|jsx|mts|mjs)$/.test(absolute) || /\.d\.ts$/.test(absolute)) continue;
    const content = await readFile(absolute, 'utf8');
    sources.set(absolute, { file: slash(path.relative(root, absolute)), hash: hash(content), ...inspectTypeScript(ts, content, absolute) });
  }
  function resolve(from, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
    const base = specifier.startsWith('@/') ? path.join(srcRoot, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
    return [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(suffix => base + suffix)].find(candidate => sources.has(candidate)) || null;
  }
  const bff = [], pages = [], files = [];
  for (const [absolute, source] of sources) {
    files.push({ file: source.file, hash: source.hash });
    if (path.dirname(absolute).startsWith(appRoot + path.sep) || path.dirname(absolute) === appRoot) {
      const pattern = routePattern(path.relative(appRoot, path.dirname(absolute)));
      if (/^route\.(?:ts|tsx|js|jsx)$/.test(path.basename(absolute))) bff.push({ path: pattern, methods: source.methods, forwards: source.forwards, file: source.file });
      if (!/^page\.(?:ts|tsx|js|jsx)$/.test(path.basename(absolute))) continue;
      const visited = new Set(), dependencies = [], apiReferences = [], unresolvedFetches = [], emptyActions = [];
      function follow(current) {
        if (visited.has(current)) return;
        visited.add(current); const currentSource = sources.get(current);
        dependencies.push(currentSource.file);
        for (const reference of currentSource.fetches) apiReferences.push({ ...reference, file: currentSource.file });
        for (const reference of currentSource.unresolvedFetches) unresolvedFetches.push({ ...reference, file: currentSource.file });
        for (const action of currentSource.emptyActions) emptyActions.push({ ...action, file: currentSource.file });
        for (const specifier of currentSource.imports) { const next = resolve(current, specifier); if (next) follow(next); }
      }
      follow(absolute);
      pages.push({ path: pattern, module: pattern.split('/')[1] || 'inicio', file: source.file, dependencies: dependencies.sort(), apiReferences, unresolvedFetches, emptyActions, runtimeVerdict: 'not_verified_per_route' });
    }
  }
  const api = [], rustSources = new Map();
  for (const absolute of await walk(path.join(root, 'apps/api/src'))) {
    if (!absolute.endsWith('.rs')) continue;
    const content = await readFile(absolute, 'utf8'), file = slash(path.relative(root, absolute));
    files.push({ file, hash: hash(content) });
    rustSources.set(absolute, content);
  }
  for (const absolute of productionRustFiles(rustSources, path.join(root, 'apps/api/src'))) {
    api.push(...rustRoutes(rustSources.get(absolute), slash(path.relative(root, absolute))));
  }
  const testFiles = (await walk(path.join(webRoot, 'tests'))).filter(file => /\.spec\.[cm]?[jt]sx?$/.test(file));
  const browserTests = [];
  for (const absolute of testFiles) {
    const content = await readFile(absolute, 'utf8');
    files.push({ file: slash(path.relative(root, absolute)), hash: hash(content) });
    const paths = [...new Set([...content.matchAll(/\.(?:goto|get|post|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)].map(match => match[1].split('?')[0]).filter(value => value.startsWith('/')))];
    browserTests.push({ file: slash(path.relative(root, absolute)), mentionedPaths: paths, runtimeVerdict: 'not_associated_per_file' });
  }
  const extra = [
    'verification/contracts.json',
    'package.json', 'Cargo.toml', 'Cargo.lock', 'apps/api/Cargo.toml',
    'apps/web/package.json', 'apps/web/tsconfig.json', 'apps/web/playwright.config.ts',
    'apps/web/playwright.company.config.ts', 'scripts/verify-company.mjs',
  ];
  for (const file of await walk(path.join(root, 'migrations'))) if (file.endsWith('.sql')) extra.push(slash(path.relative(root, file)));
  try {
    for (const file of await walk(path.join(root, 'verification'))) if (/\.(?:mjs|py|txt)$/.test(file)) extra.push(slash(path.relative(root, file)));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of extra) {
    try { files.push({ file, hash: hash(await readFile(path.join(root, file), 'utf8')) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  for (const collection of [pages, bff, api]) collection.sort((a, b) => a.path.localeCompare(b.path));
  return { schemaVersion: '1', sourceHash: hash(JSON.stringify(files)), parser: { typescript: ts.version, rust: 'production-module-literal-router-v2' }, pages, bff, api, browserTests, sourceFiles: files };
}

export function analyze(inventory) {
  const findings = [];
  const lookup = collection => new Map(collection.map(route => [normalizedRoute(route.path), route]));
  const bff = lookup(inventory.bff), api = lookup(inventory.api);
  for (const [kind, collection] of [['page', inventory.pages], ['bff', inventory.bff], ['api', inventory.api]]) {
    const seen = new Set();
    for (const route of collection) {
      const key = normalizedRoute(route.path);
      if (seen.has(key)) findings.push({ severity: 'error', code: 'duplicate_route', path: route.path, evidence: [route.file], detail: `Mais de uma definição ${kind} para o mesmo padrão; verificar roteadores e condições.` });
      seen.add(key);
    }
  }
  for (const route of inventory.bff) for (const target of route.forwards) {
    const backend = api.get(normalizedRoute(target.path));
    if (!backend && target.path.includes('{param}')) {
      const candidates = inventory.api.filter(item => compatibleRoutes(target.path, item.path));
      findings.push({ severity: 'info', code: 'dynamic_forward_requires_runtime', path: route.path, evidence: [route.file, ...candidates.map(item => item.file)], detail: `Destino dinâmico ${target.path}; ${candidates.length} rota(s) compatível(is) encontrada(s). A seleção e o método exigem execução ou análise adicional.` });
    }
    else if (!backend) findings.push({ severity: 'error', code: 'bff_target_missing', path: route.path, evidence: [route.file], detail: `forwardErp aponta para ${target.path}, não localizado nos roteadores literais.` });
    else for (const method of route.methods) if (!backend.methods.includes(method)) findings.push({ severity: 'error', code: 'bff_method_missing', path: route.path, evidence: [route.file, backend.file], detail: `${method} não encontrado no destino ${backend.path}.` });
  }
  for (const page of inventory.pages) {
    page.staticLinks = [];
    for (const reference of page.apiReferences) {
      const target = bff.get(normalizedRoute(reference.path)) || inventory.bff.find(item => compatibleRoutes(reference.path, item.path));
      page.staticLinks.push({ ...reference, bff: target?.path || null, backend: target?.forwards.map(item => item.path) || [], certainty: 'possible_import_dependency' });
      if (!target && !reference.path.includes('{param}')) findings.push({ severity: 'warning', code: 'ui_target_unresolved', path: page.path, evidence: [`${reference.file}:${reference.line}`], detail: `Referência a ${reference.path} sem handler correspondente localizado.` });
    }
    if (page.emptyActions.length) findings.push({ severity: 'warning', code: 'empty_ui_action', path: page.path, evidence: page.emptyActions.map(action => `${action.file}:${action.line}`), detail: 'Callback inline vazio encontrado na árvore de imports; verificar se está disponível nesta tela.' });
  }
  return findings;
}
