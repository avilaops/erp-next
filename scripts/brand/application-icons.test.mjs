import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function fixture(t, directory = 'app') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'avila-brand-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'sources', 'erp');
  const targetRepo = path.resolve(root, 'sources', directory);
  const script = path.join(repo, 'scripts/brand/application-icons.mjs');
  mkdirSync(path.dirname(script), { recursive: true });
  mkdirSync(path.join(repo, 'architecture/brand/assets'), { recursive: true });
  mkdirSync(path.join(targetRepo, 'public'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./application-icons.mjs', import.meta.url)), script);
  const bytes = Buffer.from('public-artwork-fixture');
  writeFileSync(path.join(repo, 'architecture/brand/assets/icon.svg'), bytes);
  const manifest = {
    assets: { 'icon.svg': createHash('sha256').update(bytes).digest('hex') },
    applications: { app: { directory, targets: { 'icon.svg': ['public/icon.svg'] } } },
  };
  const manifestFile = path.join(repo, 'architecture/brand/applications.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  return {
    repo, target: path.join(targetRepo, 'public/icon.svg'), manifest, manifestFile,
    run: (...args) => spawnSync(process.execPath, [script, '--app', 'app', ...args], { encoding: 'utf8' }),
  };
}

test('an application cannot write outside the selected source directory', (t) => {
  const f = fixture(t, '../outside');
  writeFileSync(f.target, 'keep');
  const result = f.run('--write');
  assert.notEqual(result.status, 0, 'unsafe application directory must be rejected');
  assert.equal(readFileSync(f.target, 'utf8'), 'keep');
});

test('check mode reports drift, explicit write repairs it, and a second write is empty', (t) => {
  const f = fixture(t);
  assert.equal(f.run('--check').status, 1);
  assert.equal(existsSync(f.target), false);
  assert.equal(f.run('--write').status, 0);
  assert.equal(f.run('--check').status, 0);
  assert.match(f.run('--write').stdout, /0 updated/);
});

test('a bad canonical hash or destination aborts before any file is overwritten', (t) => {
  const f = fixture(t);
  writeFileSync(f.target, 'keep');
  f.manifest.assets['icon.svg'] = '0'.repeat(64);
  writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  assert.notEqual(f.run('--write').status, 0);
  assert.equal(readFileSync(f.target, 'utf8'), 'keep');
  f.manifest.assets['icon.svg'] = createHash('sha256').update('public-artwork-fixture').digest('hex');
  f.manifest.applications.app.targets['icon.svg'].push('../outside.svg');
  writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  assert.notEqual(f.run('--write').status, 0);
  assert.equal(readFileSync(f.target, 'utf8'), 'keep');
});
