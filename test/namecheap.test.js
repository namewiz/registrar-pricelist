import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NamecheapRegistrar, RegistrarConfig } from '../dist/index.js';

function cachePath(dir) {
  return path.join(dir, 'namecheap-prices.json');
}

test('Namecheap registrar end-to-end', async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'namecheap-cache-'));
  const config = RegistrarConfig.fromEnv(process.env, { cacheDir: tmpDir });
  if (!config.isRegistrarEnabled('namecheap')) {
    t.skip('Namecheap credentials are not configured.');
    return;
  }

  const logs = [];
  const registrar = new NamecheapRegistrar(config.getNamecheapParams({ logger: (entry) => logs.push(entry.message) }));

  const live = await registrar.getPricelist(0);
  assert.ok(live.items.length > 0, 'expected at least one TLD');
  assert.equal(live.registrarId, 'namecheap');
  const liveBand = live.items[0]?.bands[0];
  assert.ok(liveBand && typeof liveBand.operations.create !== 'undefined', 'expected a price band for create operation');

  const cacheFile = cachePath(tmpDir);
  const cacheContents = JSON.parse(await readFile(cacheFile, 'utf8'));
  assert.equal(cacheContents.payload.registrarId, 'namecheap');

  const stat1 = await stat(cacheFile);
  const cached = await registrar.getPricelist(Infinity);
  const stat2 = await stat(cacheFile);
  assert.equal(cached.fetchedAt, live.fetchedAt, 'infinite TTL should reuse cached payload');
  assert.equal(stat1.mtimeMs, stat2.mtimeMs, 'infinite TTL should not rewrite cache file');

  const refreshed = await registrar.getPricelist(0);
  const stat3 = await stat(cacheFile);
  assert.notEqual(refreshed.fetchedAt, cached.fetchedAt, 'fresh TTL should refetch');
  assert.ok(stat3.mtimeMs >= stat2.mtimeMs, 'cache should be rewritten after refresh');
  assert.ok(logs.some((entry) => entry.includes('[namecheap] GET')), 'expected fetch logs to be recorded');
});
