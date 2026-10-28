import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'node:net';
import { localOrigin } from './probes.mjs';

export function testDatabase(value) {
  if (!value) throw new Error('Defina ERP_VERIFY_TEST_DATABASE_URL para uma instância PostgreSQL dedicada a testes.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('O banco de testes deve usar PostgreSQL.');
  localOrigin(`http://${url.hostname}${url.port ? ':' + url.port : ''}`);
  if (url.search || url.hash || url.pathname !== '/postgres') throw new Error('A URL deve apontar para /postgres, sem query, em uma instância local dedicada a testes.');
  return value;
}

export async function assertHarnessPortsAvailable(ports = [18441, 18081, 3202]) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(`Porta local ${port} indisponível para o harness; nenhuma aplicação existente será encerrada.`)));
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
  }
}

function redact(text, env) {
  let result = text.replace(/\u001b\[[0-9;]*m/g, '').replace(/(postgres(?:ql)?:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED_SECRET]@');
  const values = Object.entries(env).filter(([key, value]) => /TOKEN|PASSWORD|SECRET|DATABASE_URL/i.test(key) && typeof value === 'string' && value.length >= 6).map(([, value]) => value).sort((a, b) => b.length - a.length);
  for (const value of values) result = result.split(value).join('[REDACTED_SECRET]');
  return result;
}

export async function execute(command, args, { root, env, timeoutMs = 15 * 60 * 1000 }) {
  const started = Date.now();
  return new Promise(resolve => {
    let log = '', finished = false, timedOut = false;
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (exitCode, reason) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      const portConflict = exitCode !== 0 && /\bEADDRINUSE\b/.test(log);
      resolve({ exitCode, durationMs: Date.now() - started, verdict: timedOut || exitCode === null || portConflict ? 'inconclusive' : exitCode === 0 ? 'passed' : 'failed', reason: portConflict ? 'Conflito de porta no ambiente; execução não comprova falha de negócio.' : reason, log: redact(log, env) });
    };
    const append = chunk => { if (log.length < 5_000_000) log += chunk.toString(); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else child.kill('SIGTERM');
    }, timeoutMs);
    child.on('error', () => finish(null, 'Não foi possível iniciar a ferramenta; ambiente incompleto.'));
    child.on('close', code => finish(code, timedOut ? 'Tempo limite excedido; conferir recursos de teste deixados pelo processo interrompido.' : 'Resultado do comando fixo da suíte; consulte o log.'));
  });
}

export async function runSuite(name, root) {
  if (!['rust', 'flows'].includes(name)) throw new Error('Suítes permitidas: rust, flows.');
  const database = testDatabase(process.env.ERP_VERIFY_TEST_DATABASE_URL);
  if (name === 'flows') await assertHarnessPortsAvailable();
  const env = { ...process.env, DATABASE_URL: database, COMPANY_TEST_DATABASE_URL: database };
  const commands = name === 'rust'
    ? [['cargo', ['test', '--workspace'], root]]
    : [
        ['cargo', ['build', '-p', 'erp-next-api'], root],
        [process.execPath, [path.join(root, 'apps/web/node_modules/next/dist/bin/next'), 'build'], path.join(root, 'apps/web')],
        [process.execPath, [path.join(root, 'scripts/verify-company.mjs')], root],
      ];
  if (name === 'flows') {
    env.CARGO_TARGET_DIR = path.join(root, 'target/verification');
    env.ERP_TEST_API_BINARY = path.join(env.CARGO_TARGET_DIR, 'debug', process.platform === 'win32' ? 'erp-next-api.exe' : 'erp-next-api');
  }
  const steps = [];
  for (const [command, args, cwd] of commands) {
    if (name === 'flows' && args.includes(path.join(root, 'scripts/verify-company.mjs'))) {
      try { await assertHarnessPortsAvailable(); }
      catch (error) { return { id: name, verdict: 'inconclusive', reason: error.message, durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0), steps }; }
    }
    const result = await execute(command, args, { root: cwd, env });
    steps.push({ command: path.basename(command), args: args.map(arg => arg.startsWith(root) ? path.relative(root, arg).split(path.sep).join('/') : arg), ...result });
    if (result.verdict !== 'passed') break;
  }
  return { id: name, verdict: steps.find(step => step.verdict !== 'passed')?.verdict || 'passed', durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0), scope: name === 'rust' ? 'Testes Rust, incluindo integrações em bases sintéticas.' : 'Builds atuais e harness existente de navegador/persistência, com Auth e dados sintéticos.', steps };
}
