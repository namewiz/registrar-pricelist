import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XRegistrar } from '../dist/index.js';

class FakeRegistrar extends XRegistrar {
  constructor(cacheDir) {
    super({ cacheDir });
    this.id = 'fake';
    this.label = 'Fake Registrar';
    this.fetches = 0;
  }

  getCacheKey() {
    return 'fake-registrar';
  }

  async fetch() {
    this.fetches += 1;
    return this.fetches;
  }

  async parse(raw) {
    return raw;
  }

  async map(parsed) {
    return {
      registrarId: this.id,
      registrarName: this.label,
      currency: 'USD',
      fetchedAt: new Date().toISOString(),
      source: 'test',
      items: [
        {
          tld: 'example',
          bands: [
            {
              id: 'regular',
              label: 'Regular price',
              operations: { create: parsed },
            },
          ],
        },
      ],
      meta: { value: parsed },
    };
  }
}

test('XRegistrar respects TTL semantics', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'registrar-cache-'));
  const registrar = new FakeRegistrar(tmp);

  const first = await registrar.getPricelist(0);
  assert.equal(registrar.fetches, 1);
  assert.equal(first.items[0].bands[0].operations.create, 1);

  const cached = await registrar.getPricelist(Infinity);
  assert.equal(registrar.fetches, 1, 'should reuse cached payload for infinity TTL');
  assert.equal(cached.items[0].bands[0].operations.create, 1);

  const refreshed = await registrar.getPricelist(0);
  assert.equal(registrar.fetches, 2, 'fresh TTL should refetch');
  assert.equal(refreshed.items[0].bands[0].operations.create, 2);
});
