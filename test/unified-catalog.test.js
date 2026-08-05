import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCatalogRows, catalogRowsToCsv } from '../src/generators/unified.js';

function fakeResults() {
  return {
    alpha: {
      meta: { currency: 'USD' },
      data: {
        'ng': {
          'regular-price': { create: 10, renew: 12, transfer: 8 },
        },
      },
    },
    beta: {
      meta: { currency: 'USD' },
      data: {
        'ng': {
          'regular-price': { create: 20, renew: 5, transfer: 8 },
        },
        'com': {
          'regular-price': { create: 9, renew: 11, transfer: 9 },
        },
      },
    },
  };
}

test('generateCatalogRows emits one row per tld/operation with expected columns', () => {
  const rows = generateCatalogRows(fakeResults(), ['alpha', 'beta']);

  const ngCreate = rows.find((r) => r.product_sku === 'ng' && r.product_variant === 'create');
  assert.deepEqual(ngCreate, {
    product_sku: 'ng',
    product_category: 'domain',
    product_variant: 'create',
    currency: 'USD',
    price_amount: 10,
    product_features: 'provider=alpha',
  });

  const ngRenew = rows.find((r) => r.product_sku === 'ng' && r.product_variant === 'renew');
  assert.equal(ngRenew.price_amount, 5);
  assert.equal(ngRenew.product_features, 'provider=beta');

  const comTransfer = rows.find((r) => r.product_sku === 'com' && r.product_variant === 'transfer');
  assert.equal(comTransfer.price_amount, 9);
});

test('generateCatalogRows sorts rows by tld, then variant, then currency', () => {
  const rows = generateCatalogRows(fakeResults(), ['alpha', 'beta']);
  const keys = rows.map((r) => `${r.product_sku}|${r.product_variant}|${r.currency}`);
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
});

test('catalogRowsToCsv writes the price-quotes column header and escapes special characters', () => {
  const csv = catalogRowsToCsv([
    {
      product_sku: 'ng',
      product_category: 'domain',
      product_variant: 'create',
      currency: 'USD',
      price_amount: 10,
      product_features: 'provider=alpha',
    },
    {
      product_sku: 'weird,tld',
      product_category: 'domain',
      product_variant: 'create',
      currency: 'USD',
      price_amount: 1,
      product_features: 'label=say "hi"',
    },
  ]);

  const lines = csv.split('\n');
  assert.equal(lines[0], 'product_sku,product_category,product_variant,currency,price_amount,product_features');
  assert.equal(lines[1], 'ng,domain,create,USD,10,provider=alpha');
  assert.equal(lines[2], '"weird,tld",domain,create,USD,1,"label=say ""hi"""');
});
