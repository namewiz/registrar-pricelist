import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { parse } from 'csv-parse/sync';
import { loadPublicationBaseline } from '../src/publication-baseline.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function seed(dir, price) {
  const entry = { 'regular-price': { create: price, renew: price, transfer: price } };
  const snapshot = {
    meta: { currency: 'USD', generated_at: 'fixture' },
    data: { com: entry, 'com.ng': entry, '5g.in': entry, 'gov.ng': entry },
    NGN: { 'com.ng': { 'regular-price': { create: 1000, renew: 1000, transfer: 1000 } } },
  };
  const text = JSON.stringify(snapshot);
  await fs.writeFile(path.join(dir, 'nira-prices.json'), text);
  return text;
}

async function run(dir, extra = []) {
  return exec(process.execPath, [cli, '--registrars=nira', '--unified', '--fromData', `--outDir=${dir}`, ...extra], { cwd: dir });
}

async function json(dir, name) {
  return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
}

async function csv(dir, name) {
  return parse(await fs.readFile(path.join(dir, name), 'utf8'), { columns: true });
}

async function checkPublished(dir, price, unifiedOut = 'unified-prices.json') {
  const unified = await json(dir, unifiedOut);
  assert.ok(unified.every((entry) => entry['regular-price'].create === price));
  assert.ok(!unified.some((entry) => entry.tld === 'gov.ng'));
  const abridged = await json(dir, 'abridged-prices.json');
  assert.deepEqual(abridged, unified.filter((entry) => entry.tld !== '5g.in'));
  const catalog = await csv(dir, 'unified-catalog.csv');
  const abridgedCatalog = await csv(dir, 'abridged-catalog.csv');
  assert.deepEqual(abridgedCatalog, catalog.filter((row) => row.product_sku !== '5g.in'));
  for (const op of ['create', 'renew', 'transfer']) {
    const rows = await csv(dir, `unified-${op}-prices.csv`);
    assert.ok(rows.filter((row) => row.currency === 'USD').every((row) => Number(row.amount) === price));
    assert.deepEqual(catalog.filter((row) => row.product_variant === op), rows.map((row) => ({
      product_sku: row.tld, product_category: 'domain', product_variant: op,
      currency: row.currency, price_amount: row.amount, product_features: `provider=${row.provider}`,
    })));
  }
}

test('CLI preserves raw snapshots and consistent published outputs through cumulative drift', async (t) => {
  const dir = await fixture(t);
  await seed(dir, 10);
  await run(dir);
  await checkPublished(dir, 10);
  for (const price of [10.03, 10.09, 10.1]) {
    const raw = await seed(dir, price);
    await run(dir);
    assert.equal(await fs.readFile(path.join(dir, 'nira-prices.json'), 'utf8'), raw);
    await checkPublished(dir, price === 10.1 ? 10.1 : 10);
  }
  const before = await fs.readFile(path.join(dir, 'unified-prices.json'), 'utf8');
  await run(dir);
  assert.equal(await fs.readFile(path.join(dir, 'unified-prices.json'), 'utf8'), before);
});

test('CLI supports custom filenames, thresholds and disabling the policy', async (t) => {
  const dir = await fixture(t);
  const flags = ['--unifiedOut=custom.json', '--minPriceChangePercent=2'];
  await seed(dir, 10);
  await run(dir, flags);
  await seed(dir, 10.15);
  await run(dir, flags);
  await checkPublished(dir, 10, 'custom.json');
  await seed(dir, 10.2);
  await run(dir, flags);
  await checkPublished(dir, 10.2, 'custom.json');
  await seed(dir, 10.21);
  await run(dir, ['--unifiedOut=custom.json', '--minPriceChangePercent=0']);
  await checkPublished(dir, 10.21, 'custom.json');
});

test('invalid CLI thresholds fail before creating outputs', async (t) => {
  const dir = await fixture(t);
  for (const value of ['', '-1', 'NaN', 'Infinity', 'oops']) {
    await assert.rejects(run(dir, [`--minPriceChangePercent=${value}`]), /finite, nonnegative/);
  }
  await assert.rejects(run(dir, ['--minPriceChangePercent']), /finite, nonnegative/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('malformed JSON or CSV baselines fail before any published outputs change', async (t) => {
  const dir = await fixture(t);
  await seed(dir, 10);
  await run(dir);
  const cases = [
    ['unified-prices.json', '{'],
    ['unified-prices.json', '{}'],
    ['unified-prices.json', '[{"tld":"com","provider":"nira","regular-price":{"create":"10"}}]'],
    ['unified-create-prices.csv', 'bad,header\n'],
    ['unified-renew-prices.csv', 'tld,provider,currency,amount\ncom,nira,USD,NaN'],
    ['unified-transfer-prices.csv', 'tld,provider,currency,amount\ncom,nira,USD,10\ncom,nira,USD,11'],
  ];
  await seed(dir, 12);
  for (const [filename, contents] of cases) {
    const original = await fs.readFile(path.join(dir, filename));
    await fs.writeFile(path.join(dir, filename), contents);
    const files = await fs.readdir(dir);
    const before = await Promise.all(files.map((file) => fs.readFile(path.join(dir, file), 'utf8')));
    await assert.rejects(run(dir), /Invalid publication baseline/);
    const after = await Promise.all(files.map((file) => fs.readFile(path.join(dir, file), 'utf8')));
    assert.deepEqual(after, before);
    await fs.writeFile(path.join(dir, filename), original);
  }
});

test('missing baselines accept current prices independently', async (t) => {
  const dir = await fixture(t);
  assert.deepEqual(await loadPublicationBaseline(dir), { unified: [], operationRows: { create: [], renew: [], transfer: [] } });
  await seed(dir, 10);
  await run(dir);
  await fs.unlink(path.join(dir, 'unified-create-prices.csv'));
  await seed(dir, 10.01);
  await run(dir);
  assert.equal((await json(dir, 'unified-prices.json'))[0]['regular-price'].create, 10);
  assert.equal((await csv(dir, 'unified-create-prices.csv'))[0].amount, '10.01');
});

test('fetched runs save fresh registrar data while filtering published prices', async (t) => {
  const dir = await fixture(t);
  await seed(dir, 10);
  await run(dir);
  const fresh = JSON.parse(await seed(dir, 10.09));
  // Substitute generator results in the child process; exercise the normal CLI
  // fetch/save path without calling external services or using credentials.
  const niraUrl = new URL('../src/generators/nira.js', import.meta.url).href;
  const ratesUrl = new URL('../src/generators/exchange-rates.js', import.meta.url).href;
  const preload = path.join(dir, 'generators.mjs');
  await fs.writeFile(preload, `import nira from ${JSON.stringify(niraUrl)};\n` +
    `import rates from ${JSON.stringify(ratesUrl)};\n` +
    `nira._generate = async () => (${JSON.stringify(fresh)});\n` +
    `rates._generate = async () => [{ currencyCode: 'NGN', exchangeRate: 1234 }];\n`);
  await fs.unlink(path.join(dir, 'nira-prices.json'));
  await exec(process.execPath, ['--import', preload, cli, '--registrars=nira', '--unified', `--outDir=${dir}`], { cwd: dir });
  assert.deepEqual(await json(dir, 'nira-prices.json'), fresh);
  assert.deepEqual(await json(dir, 'exchange-rates.json'), [{ currencyCode: 'NGN', exchangeRate: 1234 }]);
  await checkPublished(dir, 10);
});
