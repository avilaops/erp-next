import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { childEnvironments } from './runtime-configuration.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function startSupervisor({ env = process.env, spawnProcess = spawn, fetchImpl = fetch,
  sleep = pause, attempts = 30, shutdownMs = 5000 } = {}) {
  const environments = childEnvironments(env);
  const children = new Set(), exited = new Set();
  let stopping = false, exitCode = 0, shutdownTimer;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const startup = new AbortController();
  function completed() {
    if (stopping && [...children].every(child => exited.has(child))) {
      clearTimeout(shutdownTimer);
      resolveDone(exitCode);
    }
  }
  function stop(signal = 'SIGTERM', failure = false) {
    if (failure) exitCode = 1;
    if (stopping) { completed(); return; }
    stopping = true;
    startup.abort();
    for (const child of children) if (!exited.has(child)) {
      try { child.kill(signal); } catch { exitCode = 1; }
    }
    shutdownTimer = setTimeout(() => {
      for (const child of children) if (!exited.has(child)) {
        try { child.kill('SIGKILL'); } catch { /* Container exit also ends descendants. */ }
      }
      resolveDone(1);
    }, shutdownMs);
    completed();
  }
  function launch(command, args, environment) {
    const child = spawnProcess(command, args, { env: environment, cwd: '/app', stdio: 'inherit' });
    children.add(child);
    child.once('error', () => { exited.add(child); stop('SIGTERM', true); });
    child.once('exit', () => {
      exited.add(child);
      if (!stopping) stop('SIGTERM', true);
      completed();
    });
    return child;
  }
  const ready = (async () => {
    try {
      launch('/usr/local/bin/erp-next-api', [], environments.api);
      let apiReady = false;
      for (let attempt = 0; attempt < attempts && !stopping; attempt++) {
        try {
          const response = await fetchImpl('http://127.0.0.1:8080/health/ready', {
            signal: AbortSignal.any([startup.signal, AbortSignal.timeout(1500)]),
          });
          const value = response.status === 200 ? await response.json() : null;
          if (response.status !== 200 && response.body) await response.body.cancel();
          if (value?.status === 'ready') { apiReady = true; break; }
        } catch { /* Local read-only readiness probe; never send a business command. */ }
        if (attempt + 1 < attempts && !stopping) await sleep(500);
      }
      if (!apiReady || stopping) throw Error('API startup failed');
      launch(process.execPath, ['apps/web/server.js'], environments.web);
    } catch {
      stop('SIGTERM', true);
      throw Error('ERP runtime startup failed');
    }
  })();
  // Attach immediately: a startup failure remains observable through ready, but
  // cannot become an unhandled rejection before the caller installs its handler.
  ready.catch(() => {});
  return { ready, done, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const supervisor = startSupervisor();
  process.once('SIGTERM', () => supervisor.stop());
  process.once('SIGINT', () => supervisor.stop());
  await supervisor.ready.catch(() => { console.error('ERP runtime failed to start'); });
  process.exitCode = await supervisor.done;
}
