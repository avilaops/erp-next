import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { discover, analyze } from './discovery.mjs';
import { assessContracts } from './contracts.mjs';
import { runProbes } from './probes.mjs';
import { runSuite } from './suites.mjs';
import { html, markdown, summary } from './report.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = parseArgs({ options: {
  api: { type: 'string' }, web: { type: 'string' }, suite: { type: 'string', multiple: true, default: [] },
  'ml-python': { type: 'string' }, help: { type: 'boolean', short: 'h' },
} }).values;
if (options.help) {
  console.log('node verification/run.mjs [--api http://127.0.0.1:8080] [--web http://127.0.0.1:3201] [--suite rust|flows|danfe] [--ml-python CAMINHO_PYTHON]\nSem opções: somente inventário estático e relatório. Suítes exigem ERP_VERIFY_TEST_DATABASE_URL em PostgreSQL local dedicado a testes.');
  process.exit(0);
}

function gitState() {
  try {
    return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()) };
  } catch { return { head: null, dirty: null }; }
}
async function previousReports(directory) {
  const result = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 100)) {
    try {
      const file = path.join(directory, entry.name, 'report.json');
      if ((await stat(file)).size > 15_000_000) continue;
      const report = JSON.parse(await readFile(file, 'utf8'));
      if (report.schemaVersion === '1' && report.completedAt && report.inventory?.pages && Array.isArray(report.runtime)) result.push(report);
    } catch { /* Interrupted or incompatible reports do not become a baseline. */ }
  }
  return result;
}
function comparison(previous, current) {
  if (!previous) return { status: 'no_baseline', regressions: [], addedRoutes: [], removedRoutes: [] };
  const paths = report => new Set([...report.inventory.pages.map(item => `web:${item.path}`), ...report.inventory.bff.flatMap(item => item.methods.map(method => `next:${method}:${item.path}`)), ...report.inventory.api.flatMap(item => item.methods.map(method => `api:${method}:${item.path}`))]);
  const before = paths(previous), after = paths(current);
  const oldChecks = new Map(previous.runtime.map(item => [`${item.environment}:${item.id}:${item.expected}`, item]));
  return { status: 'compared', baselineRunId: previous.runId,
    addedRoutes: [...after].filter(item => !before.has(item)), removedRoutes: [...before].filter(item => !after.has(item)),
    regressions: current.runtime.filter(item => item.verdict === 'failed' && oldChecks.get(`${item.environment}:${item.id}:${item.expected}`)?.verdict === 'passed').map(item => ({ id: item.id, environment: item.environment, from: 'passed', to: 'failed' })),
  };
}

try {
  const startedAt = new Date().toISOString();
  console.log('Descobrindo rotas e ligações no código atual...');
  const inventory = await discover(root);
  const catalogue = JSON.parse(await readFile(path.join(root, 'verification/contracts.json'), 'utf8'));
  const contracts = assessContracts(catalogue, inventory);
  const directory = path.join(root, 'artifacts/verification');
  const history = await previousReports(directory);
  const report = { schemaVersion: '1', runId: startedAt.replace(/[:.]/g, '-') + '-' + randomUUID(), startedAt, completedAt: null,
    git: gitState(), inventory, contracts, sourceHashAfter: null, findings: [...analyze(inventory, catalogue), ...contracts.findings], runtime: [], suites: [],
    ml: { status: 'not_enabled', minimumHistoricalRunsPerCheck: 20, note: 'Treinamento exige histórico real comparável; nenhum dado sintético é usado como histórico do ERP.' }, comparison: null };
  if (options.api || options.web) {
    console.log('Executando somente probes GET anônimos em loopback...');
    report.runtime = await runProbes(inventory, { apiOrigin: options.api, webOrigin: options.web });
  }
  for (const name of options.suite) {
    console.log(`Executando suíte ${name} em ambiente local de teste...`);
    try { report.suites.push(await runSuite(name, root)); }
    catch (error) { report.suites.push({ id: name, verdict: 'inconclusive', reason: error.message, durationMs: 0, steps: [] }); }
  }
  report.sourceHashAfter = (await discover(root)).sourceHash;
  report.comparison = comparison(history[0], report);
  if (options['ml-python']) {
    const result = spawnSync(options['ml-python'], [path.join(root, 'verification/ml/anomaly.py'), directory], { input: JSON.stringify(report), encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
    try { report.ml = result.status === 0 ? JSON.parse(result.stdout) : { status: 'execution_unavailable', minimumHistoricalRunsPerCheck: 20 }; }
    catch { report.ml = { status: 'invalid_model_response', minimumHistoricalRunsPerCheck: 20 }; }
  }
  report.completedAt = new Date().toISOString();
  const destination = path.join(directory, report.runId);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(destination, 'report.md'), markdown(report));
  await writeFile(path.join(destination, 'index.html'), html(report));
  console.log(JSON.stringify({ ...summary(report), ml: report.ml.status, report: path.relative(root, destination).split(path.sep).join('/') }, null, 2));
  const failed = report.findings.some(item => item.severity === 'error') || report.runtime.some(item => item.verdict === 'failed') || report.suites.some(item => item.verdict === 'failed');
  const incomplete = report.sourceHashAfter !== inventory.sourceHash || report.suites.some(item => item.verdict === 'inconclusive') || report.runtime.some(item => item.verdict === 'inconclusive');
  process.exitCode = failed ? 1 : incomplete ? 2 : 0;
} catch (error) {
  console.error(`Verificação não concluída: ${error.message}`); process.exitCode = 2;
}
