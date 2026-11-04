import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Dedicated disposable database only. The workflow seeds deterministic fixtures.
const queries = readFileSync(new URL('../../queries/system-configuration.sql', import.meta.url), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111';
function sql(statement, subject = 'evolution-owner', company = tenant) {
  assert.match(subject, /^[a-z-]*$/);
  assert.match(company, /^[0-9a-f-]{36}$/);
  const result = execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; SET LOCAL ROLE evolution_test;
      DO $$ BEGIN PERFORM set_config('app.tenant_id','${company}',true);
        PERFORM set_config('app.auth_subject','${subject}',true); END $$;
      ${queries}\n${statement}\nROLLBACK;`, encoding: 'utf8',
  }).trim();
  return result ? result.split(/\r?\n/) : [];
}
assert.deepEqual(sql('SELECT count(*) FROM legacy_evolution.record_links;'), ['5']);
assert.deepEqual(sql('SELECT price_cents FROM products;'), ['1234']);
assert.deepEqual(sql('SELECT price_cents FROM legacy_evolution.price_items;'), ['2000']);
assert.deepEqual(sql('SELECT status FROM legacy_evolution.price_versions;'), ['historical']);
assert.deepEqual(sql('SELECT item_count FROM legacy_evolution.price_version_seals;'), ['1']);
assert.deepEqual(sql("SELECT disposition FROM legacy_evolution.record_links WHERE source_collection='orders';"), ['review_required']);
assert.deepEqual(sql('SELECT count(*) FROM sales_orders; SELECT count(*) FROM stock_movements; SELECT count(*) FROM outbox_events;'), ['0','0','0']);
assert.deepEqual(sql('SELECT count(*) FROM legacy_evolution.record_links;', 'evolution-owner', '22222222-2222-4222-8222-222222222222'), ['0']);
assert.equal(sql(`EXECUTE list_system_files('${tenant}',NULL);`).length, 25);
assert.equal(sql(`EXECUTE list_system_files('${tenant}',-1);`).length, 1);
assert.equal(sql(`EXECUTE list_system_files('${tenant}',0);`).length, 1);
assert.equal(sql(`EXECUTE list_system_files('${tenant}',10000);`).length, 100);
assert.equal(sql(`EXECUTE list_system_files('${tenant}',25);`, '').length, 0);
const first = sql(`EXECUTE list_system_files('${tenant}',25);`).map(line => line.split('|')[0]);
const second = sql(`EXECUTE list_system_files_after('${tenant}','2026-01-01T00:00:00Z','${first.at(-1)}',25);`).map(line => line.split('|')[0]);
assert.equal(new Set([...first, ...second]).size, 50);
assert.ok(first.every(id => id > second[0]));
assert.equal(sql(`EXECUTE list_report_definitions('${tenant}',NULL);`).length, 2);
assert.equal(sql(`EXECUTE list_report_definitions('${tenant}',NULL);`, 'evolution-peer').length, 1);
assert.equal(sql(`EXECUTE list_report_definitions('${tenant}',NULL);`, '').length, 0);
assert.equal(sql(`EXECUTE get_product_custom_fields('${tenant}',md5('ludus:products:1')::uuid,NULL);`).length, 1);
assert.equal(sql(`EXECUTE get_product_custom_fields('${tenant}','00000000-0000-4000-8000-000000000099',NULL);`).length, 0);
console.log('Legacy reconciliation, no replay, query pagination and authenticated visibility passed.');
