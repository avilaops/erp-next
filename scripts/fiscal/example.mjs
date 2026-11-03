import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { FiscalClient, FiscalError } from './client.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    id: { type: 'string' }, revision: { type: 'string' }, key: { type: 'string' },
    input: { type: 'string' }, output: { type: 'string' }, confirm: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) return { usage: 'node scripts/fiscal/example.mjs readiness|draft|create|issue|status|consult|wait|xml|pdf [--id UUID] [--revision N --key UUID --confirm] [--input JSON_FILE] [--output NEW_FILE]' };
  const command = positionals[0];
  if (positionals.length !== 1 || !['readiness', 'draft', 'create', 'issue', 'status', 'consult', 'wait', 'xml', 'pdf'].includes(command)) throw new FiscalError('invalid_command');
  if (values.output && !['xml', 'pdf'].includes(command)) throw new FiscalError('output_only_for_documents');
  const client = FiscalClient.fromEnv(env);
  const input = { id: values.id, revision: Number(values.revision), idempotencyKey: values.key, confirm: values.confirm };
  let result;
  if (command === 'create') {
    if (!values.input) throw new FiscalError('input_file_required');
    const bytes = await readFile(values.input);
    if (bytes.length > 1024 * 1024) throw new FiscalError('input_too_large');
    result = await client.createDraft({ ...input, input: JSON.parse(bytes.toString('utf8')) });
  } else result = await client[command === 'draft' ? 'draft' : command](input);
  if (values.output) {
    const bytes = command === 'pdf' ? Buffer.from(result.data, 'base64') : result.data;
    await writeFile(values.output, bytes, { mode: 0o600, flag: 'wx' });
    return { status: result.status, output: values.output };
  }
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) {
    console.error(JSON.stringify(error instanceof FiscalError ? error.toJSON() : { code: 'example_failed' }));
    process.exitCode = 1;
  }
}
