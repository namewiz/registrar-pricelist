import test from 'node:test';
import assert from 'node:assert/strict';
import { RegistrarPriceGenerator } from '../src/core/registrar-generator.js';

test('RegistrarPriceGenerator runs generate handler', async () => {
  const generator = new RegistrarPriceGenerator({
    id: 'demo',
    label: 'Demo',
    async generate({ options }) {
      return { ok: true, options };
    },
  });

  const result = await generator.generate({ options: { foo: 'bar' } });
  assert.deepEqual(result, { ok: true, options: { foo: 'bar' } });
});

test('RegistrarPriceGenerator sets sensible defaults', () => {
  const generator = new RegistrarPriceGenerator({ id: 'demo', label: 'Demo', generate: async () => ({}) });
  assert.equal(generator.defaultOutput, 'demo-prices.json');
});

