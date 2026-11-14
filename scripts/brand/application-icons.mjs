#!/usr/bin/env node
// Copy approved public artwork only. Never walk customer asset directories.
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const brandDirectory = path.join(repository, 'architecture/brand');
const manifest = JSON.parse(await readFile(path.join(brandDirectory, 'applications.json'), 'utf8'));
const options = { app: 'erp', sourceRoot: path.dirname(repository), write: false, all: false };
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--write') options.write = true;
  else if (arg === '--check') options.write = false;
  else if (arg === '--all') options.all = true;
  else if ((arg === '--app' || arg === '--source-root') && process.argv[index + 1]) {
    options[arg === '--app' ? 'app' : 'sourceRoot'] = process.argv[++index];
  } else throw new Error(`Unknown or incomplete argument: ${arg}`);
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function contained(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Asset destination must be a file inside its repository');
  }
}
async function destination(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe asset path');
  const target = path.resolve(root, relative);
  contained(root, target);
  let ancestor = target;
  for (;;) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Asset symlinks are unsupported');
      const resolved = await realpath(ancestor);
      if (resolved !== root) contained(root, resolved);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    ancestor = path.dirname(ancestor);
    if (ancestor === root) break;
  }
  return target;
}

// Validate the complete selection before any copy takes place.
const sources = new Map();
for (const [filename, expected] of Object.entries(manifest.assets)) {
  const source = await destination(await realpath(brandDirectory), `assets/${filename}`);
  const bytes = await readFile(source);
  if (hash(bytes) !== expected) throw new Error(`Canonical asset hash mismatch: ${filename}`);
  sources.set(filename, { source, hash: expected });
}
const changes = [];
let checked = 0;
const sourceRoot = await realpath(path.resolve(options.sourceRoot));
for (const id of options.all ? Object.keys(manifest.applications) : [options.app]) {
  const app = manifest.applications[id];
  if (!app) throw new Error(`Unknown application: ${id}`);
  if (typeof app.directory !== 'string' || !/^[\w.-]+$/.test(app.directory) || app.directory === '..' || app.directory === '.') {
    throw new Error('Application directory must be a direct child of source-root');
  }
  const root = await realpath(id === 'erp' ? repository : path.resolve(sourceRoot, app.directory));
  if (id !== 'erp') contained(sourceRoot, root);
  for (const [filename, targets] of Object.entries(app.targets)) {
    if (!sources.has(filename)) throw new Error(`Unknown canonical asset: ${filename}`);
    for (const relative of targets) {
      const target = await destination(root, relative);
      let current;
      try { current = hash(await readFile(target)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      checked++;
      if (current !== sources.get(filename).hash) changes.push({ id, relative, target, source: sources.get(filename).source });
    }
  }
}
for (const change of changes) {
  console.log(`${options.write ? 'UPDATE' : 'MISMATCH'} ${change.id} • ${change.relative}`);
  if (options.write) {
    await mkdir(path.dirname(change.target), { recursive: true });
    await copyFile(change.source, change.target);
  }
}
console.log(`Verified ${checked} destinations • ${changes.length} ${options.write ? 'updated' : 'mismatches'}`);
if (changes.length && !options.write) process.exitCode = 1;
