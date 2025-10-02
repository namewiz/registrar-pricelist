import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NiraRegistrar, RegistrarConfig } from '../dist/index.js';

function cachePath(dir) {
  return path.join(dir, 'nira-prices.json');
}

function isNetworkError(err) {
  if (!err || typeof err !== 'object') return false;
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : err;
  return typeof cause.code === 'string' && cause.code === 'ENETUNREACH';
}

test('NIRA registrar end-to-end', async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nira-cache-'));
  const config = RegistrarConfig.fromEnv(process.env, { cacheDir: tmpDir });
  if (!config.isRegistrarEnabled('nira')) {
    t.skip('NIRA registrar disabled.');
    return;
  }

  const registrar = new NiraRegistrar(config.getNiraParams());
  let live;
  try {
    live = await registrar.getPricelist(0);
  } catch (err) {
    if (isNetworkError(err)) {
      t.skip('Network unreachable for NIRA FX feed.');
      return;
    }
    throw err;
  }
  assert.equal(live.registrarId, 'nira');
  assert.ok(live.items.length >= 3, 'expected multiple NGN-derived TLDs');
  assert.equal(live.currency, 'USD');
  assert.ok(typeof live.meta?.exchange === 'string', 'expected exchange note');

  const cacheFile = cachePath(tmpDir);
  const cacheContents = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.equal(cacheContents.payload.meta.notes.includes('USD prices derived'), true);

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
