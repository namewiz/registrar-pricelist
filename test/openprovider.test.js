import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OpenproviderRegistrar, RegistrarConfig } from '../dist/index.js';

function cachePath(dir) {
  return path.join(dir, 'openprovider-prices.json');
}

function isNetworkError(err) {
  if (!err || typeof err !== 'object') return false;
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : err;
  return typeof cause.code === 'string' && cause.code === 'ENETUNREACH';
}

test('OpenProvider registrar end-to-end', async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'openprovider-cache-'));
  const config = RegistrarConfig.fromEnv(process.env, { cacheDir: tmpDir });
  if (!config.isRegistrarEnabled('openprovider')) {
    t.skip('OpenProvider registrar disabled.');
    return;
  }

  const registrar = new OpenproviderRegistrar(config.getOpenproviderParams());
  let live;
  try {
    live = await registrar.getPricelist(0);
  } catch (err) {
    if (isNetworkError(err)) {
      t.skip('Network unreachable for OpenProvider dataset.');
      return;
    }
    throw err;
  }
  assert.equal(live.registrarId, 'openprovider');
  assert.ok(live.items.length > 0, 'expected rows from sheet');
  assert.ok(live.meta && typeof live.meta.rowsProcessed === 'number', 'expected meta rowsProcessed');
  const firstItem = live.items[0];
  assert.ok(firstItem.bands.length > 0, 'expected at least one price band');

  const cacheFile = cachePath(tmpDir);
  const cacheContents = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.equal(cacheContents.payload.source.startsWith('https://docs.google.com/'), true, 'expected Google Sheets source');

  const stat1 = await stat(cacheFile);
  const cached = await registrar.getPricelist(Infinity);
  const stat2 = await stat(cacheFile);
  assert.equal(cached.fetchedAt, live.fetchedAt);
  assert.equal(stat1.mtimeMs, stat2.mtimeMs);

  const refreshed = await registrar.getPricelist(0);
  const stat3 = await stat(cacheFile);
  assert.notEqual(refreshed.fetchedAt, cached.fetchedAt);
  assert.ok(stat3.mtimeMs >= stat2.mtimeMs);
});
